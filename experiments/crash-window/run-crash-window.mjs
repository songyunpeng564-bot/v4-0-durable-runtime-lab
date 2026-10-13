// DIAGNOSTIC experiment. A duplicate external effect is a FAIL, never a PASS.
// Runs only on a separate hosted disposable Linux runner; no V3, no real APIs.
import { spawn } from 'node:child_process';
import { readFileSync, openSync, closeSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { inputFor } from './crash-effect.mjs';

const base = 'postgresql://synthetic_user:synthetic_local_only@127.0.0.1:5432/synthetic_v4_db';
const cwd = process.cwd();
if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.V4_RUN_CRASH_WINDOW !== 'approved' ||
    process.env.DBOS_SYSTEM_DATABASE_URL !== base ||
    !process.env.RUNNER_TEMP || !resolve(cwd).startsWith(resolve(process.env.RUNNER_TEMP)+'/'))
  throw Error('experiment_refuses_non_disposable_host');
const env = {PATH:process.env.PATH, HOME:process.env.HOME, CI:'true', NODE_ENV:'test',
  DBOS_SYSTEM_DATABASE_URL:base, V4_CRASH_TEST_MODE:'isolated-github-runner'};
const children=[];
function owned(name,cmd,args,moreEnv={}) {
  const path=join(cwd,`${name}.log`);
  const fd=openSync(path,'w',0o600);
  let child;
  try { child=spawn(cmd,args,{cwd,env:{...env,...moreEnv},stdio:['ignore',fd,fd]}); }
  finally {closeSync(fd);}
  const item={name,child,path};children.push(item);
  return item;
}
function exitResult(item) {
  return {code:item.child.exitCode,signal:item.child.signalCode};
}
async function waitClose(item,maxMs=25000) {
  if(item.child.exitCode!==null || item.child.signalCode!==null) return exitResult(item);
  return new Promise((resolve,reject)=>{
    let timer;
    const done=(err,result)=>{clearTimeout(timer);item.child.off('close',onClose);item.child.off('error',onError);err?reject(err):resolve(result);};
    const onClose=(code,signal)=>done(null,{code,signal});
    const onError=e=>done(e);
    item.child.once('close',onClose);item.child.once('error',onError);
    timer=setTimeout(()=>done(Error(`${item.name}_exit_not_confirmed`)),maxMs);
  });
}
async function portReady(port,item) {
  for(let i=0;i<60;i++) {
    if(item.child.exitCode!==null || item.child.signalCode!==null) throw Error(`${item.name}_premature_exit`);
    const ok=await new Promise(resolve=>{
      const s=connect({host:'127.0.0.1',port});
      s.setTimeout(300);
      s.once('connect',()=>{s.destroy();resolve(true)});
      s.once('error',()=>{s.destroy();resolve(false)});
      s.once('timeout',()=>{s.destroy();resolve(false)});
    });
    if(ok) return;
    await delay(250);
  }
  throw Error(`own_port_${port}_not_ready`);
}
async function evidence() {
  const r=await fetch('http://127.0.0.1:9186/evidence',{signal:AbortSignal.timeout(3000)});
  if(!r.ok) throw Error('receiver_evidence_not_readable');
  const j=await r.json();
  const disk=readFileSync(join(cwd,'synthetic-receiver-ledger.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  if(JSON.stringify(j.records)!==JSON.stringify(disk)) throw Error('disk_evidence_mismatch');
  return disk;
}
async function count(framework) {
  const key=inputFor(framework).operationId;
  return (await evidence()).filter(x=>x.operationId===key).length;
}
function proveFirst(framework,exitCode,countBefore) {
  if(exitCode.code!==73 || exitCode.signal!==null || countBefore!==1 ||
      !existsSync(join(cwd,`crash-once-${framework}.marker`)))
    throw Error(`${framework}_crash_gate_not_proven exit=${JSON.stringify(exitCode)} effects=${countBefore}`);
  console.log(`CRASH_INJECTION_CONFIRMED framework=${framework} exit=73 effects_before_restart=1`);
}
async function stop(item) {
  if(item.child.exitCode===null && item.child.signalCode===null) item.child.kill('SIGTERM');
  try { await waitClose(item,2500); } catch { console.error('OWNED_CHILD_EXIT_UNCONFIRMED',item.name); }
}
let outcome={};let unsafe=false;let incomplete=false;
try {
  const receiver=owned('effect-receiver',process.execPath,['./synthetic-receiver.mjs']);
  await portReady(9186,receiver);
  const server=owned('restate-server','./node_modules/.bin/restate-server',[]);
  await portReady(9070,server); await portReady(8080,server);
  // DBOS: first test-only worker self-exits; PostgreSQL and receiver stay alive.
  const firstDbos=owned('dbos-first',process.execPath,['./dbos-worker.mjs'],{V4_WORKER_ROLE:'first'});
  const dbosCrash=await waitClose(firstDbos,30000);
  proveFirst('dbos',dbosCrash,await count('dbos'));
  const recoveredDbos=owned('dbos-recover',process.execPath,['./dbos-worker.mjs'],{V4_WORKER_ROLE:'recover'});
  let dbosExit;
  try {dbosExit=await waitClose(recoveredDbos,26000);}
  catch(e){dbosExit={code:null,reason:String(e)}; await stop(recoveredDbos);}
  await delay(1000);
  const dbosEffects=await count('dbos');
  const dbosCompleted=dbosExit.code===0 && existsSync(join(cwd,'dbos-recovery-result.json'));
  outcome.dbos={firstExit:dbosCrash.code,recoveryExit:dbosExit.code,effects:dbosEffects,
    completed:dbosCompleted,classification:dbosEffects>1?'UNSAFE_DUPLICATE':dbosCompleted?'RECOVERED_SINGLE_EFFECT':'RECOVERY_UNCONFIRMED'};
  console.log(`CRASH_RESULT framework=dbos class=${outcome.dbos.classification} effects=${dbosEffects} completed=${dbosCompleted}`);
  unsafe ||= dbosEffects>1; incomplete ||= !dbosCompleted;

  // Restate server survives the *SDK endpoint* self-exit and keeps its journal.
  const firstRestate=owned('restate-first',process.execPath,['./restate-worker.mjs']);
  await portReady(9082,firstRestate);
  const registration=await fetch('http://127.0.0.1:9070/deployments',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({uri:'http://127.0.0.1:9082'}),signal:AbortSignal.timeout(10000)});
  if(!registration.ok) throw Error(`restate_registration_${registration.status}_${(await registration.text()).slice(0,200)}`);
  console.log('RESTATE_CRASH_SERVICE_REGISTRATION=PASS');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),27000);
  const invocation=fetch('http://127.0.0.1:8080/CrashWindowSafety/dispatch',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(inputFor('restate')),signal:controller.signal,
  }).then(async r=>({code:r.status,body:(await r.text()).slice(0,500)})).catch(e=>({error:String(e)}))
    .finally(()=>clearTimeout(timer));
  const restateCrash=await waitClose(firstRestate,20000);
  proveFirst('restate',restateCrash,await count('restate'));
  const restartRestate=owned('restate-recover',process.execPath,['./restate-worker.mjs']);
  await portReady(9082,restartRestate);
  const response=await invocation; // May timeout: no false success.
  await delay(2500); // bounded observation for background replay
  const restateEffects=await count('restate');
  let parsed;
  try{parsed=JSON.parse(response.body||'');}catch{parsed=null;}
  const restateCompleted=response.code===200 && parsed?.operationId===inputFor('restate').operationId;
  outcome.restate={firstExit:restateCrash.code,recoveryResponse:response,
    effects:restateEffects,completed:restateCompleted,
    classification:restateEffects>1?'UNSAFE_DUPLICATE':restateCompleted?'RECOVERED_SINGLE_EFFECT':'RECOVERY_UNCONFIRMED'};
  console.log(`CRASH_RESULT framework=restate class=${outcome.restate.classification} effects=${restateEffects} completed=${restateCompleted}`);
  unsafe ||= restateEffects>1;incomplete ||= !restateCompleted;
  console.log('CRASH_COMPARISON_JSON='+JSON.stringify(outcome));
  if(unsafe) {console.error('CRASH_WINDOW_UNSAFE_DUPLICATE_OBSERVED=TRUE');process.exitCode=1;}
  else if(incomplete){console.error('CRASH_WINDOW_RECOVERY_INCONCLUSIVE=TRUE');process.exitCode=1;}
  else console.log('CRASH_WINDOW_BOTH_RECOVERED_WITH_SINGLE_EFFECT=PASS');
} catch(e) {
  console.error('CRASH_WINDOW_GATE_FAILED',e?.stack||String(e));
  process.exitCode=1;
} finally {
  for(const item of [...children].reverse()){
    await stop(item); // Only spawned, known child objects. No PID search or lock deletion.
    try{const tail=readFileSync(item.path,'utf8').slice(-1400);if(process.exitCode)console.error(`OWNED_${item.name}_LOG_TAIL`,tail);}catch{}
  }
  console.log('WINDOWS_ORIGINAL_P0=0/6_NOT_RUN');
  console.log('HISTORIC_57_THREE_WAY=NOT_RUN');
  console.log('USER_WINDOWS_AND_V3_UNTOUCHED=true');
}
