// Owned test children only; count all attempts separately from committed effects.
import { spawn } from 'node:child_process';
import { openSync,closeSync,readFileSync,existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { inputFor } from './effect-mitigations.mjs';
const cwd=process.cwd();
const expectedDb='postgresql://synthetic_user:synthetic_local_only@127.0.0.1:5432/synthetic_v4_db';
if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true'||
   process.env.V4_MITIGATION_APPROVED!=='yes'||
   process.env.DBOS_SYSTEM_DATABASE_URL!==expectedDb||!process.env.RUNNER_TEMP||
   !resolve(cwd).startsWith(resolve(process.env.RUNNER_TEMP)+'/'))
  throw Error('experiment_not_on_approved_disposable_runner');
const env={PATH:process.env.PATH,HOME:process.env.HOME,CI:'true',NODE_ENV:'test',
  V4_MITIGATION_TEST:'isolated-github-runner',DBOS_SYSTEM_DATABASE_URL:expectedDb};
const children=[];
function owned(name,cmd,args,other={}){
  const path=join(cwd,`${name}.log`),fd=openSync(path,'w',0o600);
  let child;
  try{child=spawn(cmd,args,{cwd,env:{...env,...other},stdio:['ignore',fd,fd]});}
  finally{closeSync(fd);}
  const o={name,child,path};children.push(o);return o;
}
async function closed(o,timeout=24000){
  if(o.child.exitCode!==null||o.child.signalCode!==null)return {code:o.child.exitCode,signal:o.child.signalCode};
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(e,val)=>{if(done)return;done=true;clearTimeout(timer);o.child.off('close',onClose);o.child.off('error',onError);e?reject(e):resolve(val);};
    const onClose=(code,signal)=>finish(null,{code,signal});const onError=e=>finish(e);
    o.child.once('close',onClose);o.child.once('error',onError);
    const timer=setTimeout(()=>finish(Error(`${o.name}_close_unconfirmed`)),timeout);
  });
}
async function ready(port,o){
  for(let i=0;i<70;i++){
    if(o.child.exitCode!==null||o.child.signalCode!==null)throw Error(`${o.name}_premature_exit`);
    const ok=await new Promise(resolve=>{
      const s=connect({host:'127.0.0.1',port});s.setTimeout(300);
      s.once('connect',()=>{s.destroy();resolve(true)});
      s.once('error',()=>{s.destroy();resolve(false)});
      s.once('timeout',()=>{s.destroy();resolve(false)});
    });
    if(ok)return;await delay(250);
  }
  throw Error(`port_${port}_not_ready`);
}
function read(path){return existsSync(join(cwd,path))?readFileSync(join(cwd,path),'utf8').split('\n').filter(Boolean).map(JSON.parse):[];}
async function evidence(){
  const r=await fetch('http://127.0.0.1:9187/evidence',{signal:AbortSignal.timeout(3000)});
  if(!r.ok)throw Error('missing_independent_evidence');
  const data=await r.json(),attempts=read('synthetic-attempts.jsonl'),effects=read('synthetic-effects.jsonl');
  if(JSON.stringify(data.attempts)!==JSON.stringify(attempts)||JSON.stringify(data.effects)!==JSON.stringify(effects))
    throw Error('durable_receiver_evidence_mismatch');
  return {attempts,effects};
}
async function metrics(framework,mode){
  const id=inputFor(framework,mode).operationId,{attempts,effects}=await evidence();
  return {attempts:attempts.filter(v=>v.operationId===id).length,effects:effects.filter(v=>v.operationId===id).length};
}
async function stop(o){
  if(o.child.exitCode===null&&o.child.signalCode===null)o.child.kill('SIGTERM');
  try{await closed(o,1800);}catch{console.error('OWNED_CHILD_EXIT_UNCONFIRMED',o.name);}
}
function confirmCrash(framework,mode,exit,before){
  if(exit.code!==73||exit.signal!==null||before.attempts!==1||before.effects!==1||
      !existsSync(join(cwd,`crash-once-${inputFor(framework,mode).operationId}.marker`)))
    throw Error(`crash_evidence_invalid_${framework}_${mode}:${JSON.stringify({exit,before})}`);
  console.log(`FIRST_EFFECT_AND_EXIT_CONFIRMED framework=${framework} mode=${mode} exit=73 attempts=1 effects=1`);
}
function validate(framework,mode,result,after){
  const expected=mode==='dedup'?{attempts:2,effects:1}:{attempts:1,effects:1};
  const status=mode==='dedup'?'ACK_CONFIRMED':'OUTCOME_UNKNOWN';
  if(JSON.stringify(after)!==JSON.stringify(expected)||result?.status!==status||
     result?.operationId!==inputFor(framework,mode).operationId||
     (mode==='dedup'&&result.duplicate!==true))
    throw Error(`MITIGATION_NOT_PROVEN ${JSON.stringify({framework,mode,result,after,expected})}`);
  console.log(`MITIGATION_CASE_PASS framework=${framework} mode=${mode} attempts=${after.attempts} effects=${after.effects} status=${status}`);
}
async function dbosCase(mode){
  const first=owned(`dbos-${mode}-first`,process.execPath,['./dbos-worker.mjs'],{V4_MODE:mode,V4_WORKER_ROLE:'first'});
  const exit=await closed(first,30000);confirmCrash('dbos',mode,exit,await metrics('dbos',mode));
  const next=owned(`dbos-${mode}-recover`,process.execPath,['./dbos-worker.mjs'],{V4_MODE:mode,V4_WORKER_ROLE:'recover'});
  const outcome=await closed(next,29000);if(outcome.code!==0)throw Error(`dbos_recover_failed_${mode}:${JSON.stringify(outcome)}`);
  const result=JSON.parse(readFileSync(join(cwd,`dbos-result-${mode}.json`),'utf8'));
  validate('dbos',mode,result,await metrics('dbos',mode));
}
async function restateCase(mode){
  const first=owned(`restate-${mode}-first`,process.execPath,['./restate-worker.mjs']);
  await ready(9083,first);
  if(mode==='dedup'){
    const r=await fetch('http://127.0.0.1:9070/deployments',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({uri:'http://127.0.0.1:9083'}),signal:AbortSignal.timeout(9000)});
    if(!r.ok)throw Error(`restate_register_${r.status}:${(await r.text()).slice(0,150)}`);
    console.log('RESTATE_MITIGATION_SERVICE_REGISTERED=PASS');
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);
  const invocation=fetch('http://127.0.0.1:8080/CrashMitigationSafety/dispatch',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(inputFor('restate',mode)),
    signal:controller.signal,
  }).then(async r=>({status:r.status,body:await r.text()}))
    .catch(e=>({error:String(e)})).finally(()=>clearTimeout(timer));
  const exit=await closed(first,22000);confirmCrash('restate',mode,exit,await metrics('restate',mode));
  const next=owned(`restate-${mode}-recover`,process.execPath,['./restate-worker.mjs']);
  await ready(9083,next);
  const response=await invocation;
  let result;
  try{result=JSON.parse(response.body);}catch{throw Error(`restate_response_unknown_${mode}:${JSON.stringify(response).slice(0,300)}`);}
  if(response.status!==200)throw Error(`restate_response_not_200_${mode}`);
  await delay(650);
  validate('restate',mode,result,await metrics('restate',mode));
  await stop(next);
}
let failure=false;
try {
  const receiver=owned('synthetic-receiver',process.execPath,['./safe-receiver.mjs']);
  await ready(9187,receiver);
  const server=owned('restate-server','./node_modules/.bin/restate-server',[]);
  await ready(9070,server);await ready(8080,server);
  for(const mode of ['dedup','unknown']) await dbosCase(mode);
  for(const mode of ['dedup','unknown']) await restateCase(mode);
  const {attempts,effects}=await evidence();
  if(attempts.length!==6||effects.length!==4||new Set(effects.map(e=>e.operationId)).size!==4)
    throw Error(`final_ledger_mismatch attempts=${attempts.length} effects=${effects.length}`);
  console.log('MITIGATION_FINAL_ATTEMPTS=6');
  console.log('MITIGATION_FINAL_COMMITTED_EFFECTS=4');
  console.log('MITIGATION_REAL_FRAMEWORK_4_OF_4_PASS=TRUE');
}catch(e){failure=true;console.error('MITIGATION_TEST_FAILED',e?.stack??String(e));process.exitCode=1;}
finally{
  for(const o of [...children].reverse()){
    await stop(o);
    if(failure){try{console.error(`OWNED_${o.name}_LOG_TAIL`,readFileSync(o.path,'utf8').slice(-2500));}catch{}}
  }
  console.log('NO_V3_OR_WINDOWS_FAULTS=true');
  console.log('ORIGINAL_WINDOWS_P0=0/6_NOT_RUN');
  console.log('HISTORIC_57=NOT_RUN');
}
