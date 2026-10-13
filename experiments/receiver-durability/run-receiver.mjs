// Independent Postgres transactional idempotency experiment. No DBOS/Restate or production APIs.
import { spawn } from 'node:child_process';
import { openSync,closeSync,readFileSync,realpathSync } from 'node:fs';
import { resolve,sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { SPEC,isolatedRunner } from './contract.mjs';
if(!isolatedRunner() || !realpathSync(process.cwd()).startsWith(realpathSync(process.env.RUNNER_TEMP)+sep))
  throw Error('REFUSE_NON_DISPOSABLE_RUNNER');
const pool=new pg.Pool({connectionString:process.env.PGURL,max:6,connectionTimeoutMillis:3000});
const owned=[];
function child(name,port,crash){
  const fd=openSync(`${name}.log`,'wx',0o600);
  let p;
  try {p=spawn(process.execPath,['./receiver.mjs'],{
    cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:process.env.HOME,GITHUB_ACTIONS:'true',RUNNER_TEMP:process.env.RUNNER_TEMP,
      V4_RECEIVER_APPROVED:'yes',PGURL:process.env.PGURL,V4_RECEIVER_NAME:port===9191?'a':'b',
      V4_RECEIVER_PORT:String(port),V4_ENABLE_COMMIT_CRASH:crash?'yes':'no'},
    stdio:['ignore',fd,fd]});
  } finally {closeSync(fd);}
  const obj={name,port,p};owned.push(obj);return obj;
}
function awaitClose(obj,ms=7000){
  return new Promise((resolve,reject)=>{
    if(obj.p.exitCode!==null || obj.p.signalCode!==null){resolve({code:obj.p.exitCode,signal:obj.p.signalCode});return;}
    let done=false;
    const complete=(error,result)=>{if(done)return;done=true;clearTimeout(timer);obj.p.off('close',onClose);obj.p.off('error',onError);
      error?reject(error):resolve(result);};
    const onClose=(code,signal)=>complete(null,{code,signal});const onError=e=>complete(e);
    obj.p.once('close',onClose);obj.p.once('error',onError);
    const timer=setTimeout(()=>complete(Error(`${obj.name}_EXIT_NOT_CONFIRMED`)),ms);
  });
}
async function awaitHealthy(obj){
  for(let i=0;i<55;i++){
    if(obj.p.exitCode!==null||obj.p.signalCode!==null)throw Error(`${obj.name}_EXIT_BEFORE_HEALTH`);
    try {const r=await fetch(`http://127.0.0.1:${obj.port}/health`,{signal:AbortSignal.timeout(500)});
      if(r.ok && await r.text()==='SYNTHETIC_OK')return;}catch{}
    await delay(200);
  }
  throw Error(`${obj.name}_NO_HEALTH`);
}
async function send(port,value){
  const response=await fetch(`http://127.0.0.1:${port}/effect`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(6500)});
  let data;try{data=await response.json();}catch{throw Error(`MALFORMED_EFFECT_RESPONSE_${response.status}`);}
  return {httpStatus:response.status,...data};
}
async function table(){
  const [a,e]=await Promise.all([
    pool.query('SELECT operation_id,stage,receiver_name,verdict FROM v4_test_attempts ORDER BY attempt_id'),
    pool.query('SELECT operation_id,stage,payload_sha FROM v4_test_effects ORDER BY operation_id'),
  ]);
  return {attempts:a.rows,effects:e.rows};
}
function count(rows,id){return rows.filter(x=>x.operation_id===id).length;}
function assert(ok,code){if(!ok)throw Error(code);}
async function stop(obj){
  if(obj.p.exitCode===null&&obj.p.signalCode===null)obj.p.kill('SIGTERM');
  const exit=await awaitClose(obj,6000);assert(exit.code===0&&exit.signal===null,`${obj.name}_UNSAFE_SHUTDOWN`);
}
try{
  await pool.query(`CREATE TABLE v4_test_effects(
    operation_id text PRIMARY KEY, stage text NOT NULL, payload_sha text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
  await pool.query(`CREATE TABLE v4_test_attempts(
    attempt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation_id text NOT NULL, stage text NOT NULL, receiver_name text NOT NULL,
    verdict text NOT NULL CHECK(verdict IN ('committed','duplicate','key_conflict')),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
  const a=child('receiver-a-crash',9191,true),b=child('receiver-b',9192,false);
  await Promise.all([awaitHealthy(a),awaitHealthy(b)]);
  const exitPromise=awaitClose(a,12000);
  const firstPromise=send(9191,{...SPEC.crash,trigger:'crash'}).then(v=>({ok:true,v}),e=>({ok:false,error:String(e)}));
  const firstExit=await exitPromise;
  const firstResponse=await firstPromise;
  let snapshot=await table();
  assert(firstExit.code===73&&firstExit.signal===null,'OWNED_RECEIVER_CRASH_NOT_73');
  assert(firstResponse.ok===false,'FIRST_RESPONSE_NOT_ACTUALLY_LOST');
  assert(count(snapshot.effects,SPEC.crash.operationId)===1&&count(snapshot.attempts,SPEC.crash.operationId)===1,
    'FIRST_COMMIT_NOT_DURABLE_BEFORE_CRASH');
  console.log('RECEIVER_CRASH_AFTER_TRANSACTION_BEFORE_ACK=PASS firstExit=73 attempts=1 effects=1');
  const restart=child('receiver-a-restarted',9191,false);await awaitHealthy(restart);
  const retry=await send(9191,{...SPEC.crash,trigger:'none'});
  assert(retry.httpStatus===200&&retry.verdict==='duplicate'&&retry.duplicate===true,
    'CRASH_RETRY_NOT_DEDUPED');
  snapshot=await table();
  assert(count(snapshot.attempts,SPEC.crash.operationId)===2&&count(snapshot.effects,SPEC.crash.operationId)===1,
    'CRASH_RETRY_CREATED_DUPLICATE_EFFECT');
  console.log('RECEIVER_RESTART_IDEMPOTENT_REPLAY=PASS attempts=2 committedEffects=1');

  const N=32;
  const concurrent=await Promise.all(Array.from({length:N},(_,i)=>send(i%2===0?9191:9192,
    {...SPEC.parallel,trigger:'none'})));
  assert(concurrent.every(r=>r.httpStatus===200&&r.status==='ACK_CONFIRMED'), 'CONCURRENT_RESPONSE_ERROR');
  assert(concurrent.filter(r=>r.verdict==='committed').length===1 &&
    concurrent.filter(r=>r.verdict==='duplicate').length===N-1, 'CONCURRENT_SINGLE_WINNER_NOT_PROVEN');
  snapshot=await table();
  assert(count(snapshot.attempts,SPEC.parallel.operationId)===N&&count(snapshot.effects,SPEC.parallel.operationId)===1,
    'CONCURRENT_DUPLICATE_EXTERNAL_EFFECT');
  console.log(`POSTGRES_TWO_RECEIVERS_32_CONCURRENT=PASS attempts=${N} committedEffects=1`);
  const conflict=await send(9192,{...SPEC.parallel,stage:'synthetic_changed',trigger:'none'});
  assert(conflict.httpStatus===409&&conflict.status==='IDEMPOTENCY_KEY_REUSE'&&conflict.verdict==='key_conflict',
    'SAME_ID_DIFFERENT_PAYLOAD_NOT_REJECTED');
  snapshot=await table();
  assert(count(snapshot.effects,SPEC.parallel.operationId)===1&&count(snapshot.attempts,SPEC.parallel.operationId)===N+1,
    'COLLISION_CHANGED_EFFECT_OR_HID_ATTEMPT');
  console.log('IDEMPOTENCY_KEY_DIFFERENT_PAYLOAD=REJECTED_409_WITH_ATTEMPT_RECORDED');
  await Promise.all([stop(restart),stop(b)]);
  const fresh=child('receiver-a-second-restart',9191,false);await awaitHealthy(fresh);
  const evidenceResponse=await fetch('http://127.0.0.1:9191/evidence',{signal:AbortSignal.timeout(3000)});
  assert(evidenceResponse.status===200,'RESTARTED_RECEIVER_CANNOT_READ_DB');
  const observed=await evidenceResponse.json();
  const durable=await table();
  assert(JSON.stringify(observed)===JSON.stringify(durable),'INDEPENDENT_RECEIVER_READBACK_DISAGREES_WITH_DB');
  assert(durable.attempts.length===35&&durable.effects.length===2,
    `INCORRECT_FINAL_COUNTS_${durable.attempts.length}_${durable.effects.length}`);
  console.log('POSTGRES_RESTARTED_RECEIVER_DURABLE_READBACK=PASS');
  console.log('TRANSACTIONAL_RECEIVER_TOTAL_ATTEMPTS=35');
  console.log('TRANSACTIONAL_RECEIVER_TOTAL_EFFECTS=2');
  console.log('POSTGRES_RECEIVER_CRASH_CONCURRENCY_4_OF_4_PASS=TRUE');
  await stop(fresh);
}catch(e){
  process.exitCode=1;
  console.error('POSTGRES_RECEIVER_EXPERIMENT_FAILED',e?.stack??String(e));
  for(const c of owned){try{console.error(`OWNED_${c.name}_LOG_TAIL`,readFileSync(`${c.name}.log`,'utf8').slice(-2800));}catch{}}
}finally{
  for(const o of owned){
    if(o.p.exitCode===null&&o.p.signalCode===null){o.p.kill('SIGTERM');try{await awaitClose(o,4500);}catch{
      console.error('OWNED_CHILD_EXIT_UNCONFIRMED',o.name);process.exitCode=1;
    }}
  }
  await pool.end().catch(e=>{console.error('POSTGRES_POOL_CLOSE_ERROR',String(e));process.exitCode=1;});
  console.log('NO_REAL_EXTERNAL_BUSINESS_OPERATIONS=true');
  console.log('RECEIVER_POSTGRES_SERVICE_RESTART_OR_POWER_LOSS=NOT_RUN');
  console.log('ORIGINAL_WINDOWS_P0=0/6_NOT_RUN');
  console.log('HISTORIC_57_THREE_WAY=NOT_RUN');
}
