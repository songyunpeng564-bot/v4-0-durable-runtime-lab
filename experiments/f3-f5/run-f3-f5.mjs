// Genuine DBOS registered Workflow and Restate registered Service, one-shot F3/F4/F5
// dropped ACK on a durable synthetic receiver. This does NOT test a process crash.
import { spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { attemptEffect } from './effect-client.mjs';

const pwd = process.cwd();
const expectedDatabase = 'postgresql://synthetic_user:synthetic_local_only@127.0.0.1:5432/synthetic_v4_db';
if (process.env.DBOS_SYSTEM_DATABASE_URL !== expectedDatabase) {
  throw new Error('unsafe_or_missing_disposable_database');
}
const stages = ['codex', 'promotion', 'telegram'];
const children = [];
let DBOS, dbosLaunched = false;
const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, CI: 'true', NODE_ENV: 'test' };
function ownedChild(title, command, args) {
  const logPath = join(pwd, `synthetic-${title}.log`);
  const fd = openSync(logPath, 'w', 0o600);
  let child;
  try { child = spawn(command, args, {cwd:pwd,env:childEnv,stdio:['ignore',fd,fd]}); }
  finally { closeSync(fd); }
  children.push({title,child,logPath});
  return child;
}
async function portReady(port, child) {
  for (let n=0;n<60;n++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`child_exited_before_port_${port}`);
    const ready = await new Promise(resolve => {
      const socket = connect({host:'127.0.0.1',port});
      socket.setTimeout(450);
      socket.once('connect', () => {socket.destroy();resolve(true);});
      socket.once('error', () => {socket.destroy();resolve(false);});
      socket.once('timeout', () => {socket.destroy();resolve(false);});
    });
    if (ready) return;
    await delay(250);
  }
  throw new Error(`owned_child_port_${port}_not_ready`);
}
async function sendRestate(input) {
  const response = await fetch('http://127.0.0.1:8080/SyntheticSafety/dispatch', {
    method:'POST',headers:{'content-type':'application/json'},
    body: JSON.stringify(input), signal:AbortSignal.timeout(12000),
  });
  const body=await response.text();
  if (!response.ok) throw new Error(`restate_invocation_${response.status}:${body.slice(0,400)}`);
  try {return JSON.parse(body);} catch {throw new Error(`restate_invalid_json_response:${body.slice(0,300)}`);}
}
async function evidence() {
  const r=await fetch('http://127.0.0.1:9186/evidence',{signal:AbortSignal.timeout(3000)});
  if(!r.ok)throw new Error('evidence_unavailable');
  const d=await r.json();
  return d.records;
}
function assertUnknown(got,input) {
  if(got?.status!=='OUTCOME_UNKNOWN' || got?.operationId!==input.operationId ||
     got?.stage!==input.stage || got?.framework!==input.framework)
    throw new Error(`wrong_outcome:${JSON.stringify(got).slice(0,400)}`);
}
async function cleanupOwned() {
  if (dbosLaunched) await DBOS.shutdown().catch(e=>console.error('DBOS_SHUTDOWN_WARN',String(e)));
  for (const entry of children.reverse()) {
    if (entry.child.exitCode===null && entry.child.signalCode===null) entry.child.kill('SIGTERM');
    await Promise.race([new Promise(r=>entry.child.once('close',r)),delay(2400)]);
    // Do not guess or kill unrelated processes. A remaining child will exit
    // when this dedicated ephemeral hosted runner is torn down.
  }
}
try {
  const receiver=ownedChild('receiver',process.execPath,['./synthetic-receiver.mjs']);
  await portReady(9186,receiver);
  const server=ownedChild('restate-server','./node_modules/.bin/restate-server',[]);
  await portReady(9070,server);
  await portReady(8080,server);
  const endpoint=ownedChild('restate-service',process.execPath,['./restate-service.mjs']);
  await portReady(9080,endpoint);
  const registration=await fetch('http://127.0.0.1:9070/deployments',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({uri:'http://127.0.0.1:9080'}),signal:AbortSignal.timeout(12000),
  });
  if(!registration.ok)throw new Error(`restate_register_failed_${registration.status}:${(await registration.text()).slice(0,500)}`);
  console.log('RESTATE_REAL_SERVICE_REGISTRATION=PASS');

  ({DBOS}=await import('@dbos-inc/dbos-sdk'));
  const workflow=DBOS.registerWorkflow(async input => {
    return DBOS.runStep(()=>attemptEffect(input),{name:'synthetic-effect-with-fail-closed-receipt'});
  },{name:'v4PublicF3F5LostAck'});
  DBOS.setConfig({name:'v4-public-synthetic-f3f5',applicationVersion:'0.0.2',
    systemDatabaseUrl:expectedDatabase});
  await DBOS.launch(); dbosLaunched=true;
  console.log('DBOS_REAL_REGISTERED_WORKFLOW=PASS');

  for(const framework of ['dbos','restate']) {
    for(const stage of stages) {
      const input={framework,stage,operationId:`v4_${framework}_${stage}_lost_ack_01`,mode:'drop_ack'};
      let got;
      if(framework==='dbos') {
        const handle=await DBOS.startWorkflow(workflow, {workflowID:input.operationId})(input);
        got=await handle.getResult();
      } else {
        got=await sendRestate(input);
      }
      assertUnknown(got,input);
      const records=await evidence();
      const effects=records.filter(x=>x.operationId===input.operationId);
      if(effects.length!==1 || effects[0]?.effect!=='SYNTHETIC_EFFECT_ACCEPTED') {
        throw new Error(`unexpected_effect_count_${input.operationId}_${effects.length}`);
      }
      console.log(`F3F5_CASE_PASS framework=${framework} stage=${stage} status=OUTCOME_UNKNOWN effects=1`);
    }
  }
  await delay(1500); // Observe delayed framework background replay inside live session.
  const finalRecords=await evidence();
  if(finalRecords.length!==6 || new Set(finalRecords.map(x=>x.operationId)).size!==6)
    throw new Error(`unexpected_final_effect_count_${finalRecords.length}`);
  const ledgerLines=readFileSync(join(pwd,'synthetic-receiver-ledger.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  if(JSON.stringify(ledgerLines)!==JSON.stringify(finalRecords))throw new Error('independent_durable_ledger_mismatch');
  console.log('F3F5_REAL_WORKFLOW_6_OF_6_PASS=TRUE');
  console.log('F3F5_INDEPENDENT_FSYNC_LEDGER_EVENTS=6');
  console.log('CRASH_RESTART_AND_UNCHECKPOINTED_EFFECT_WINDOW=NOT_RUN');
} catch(e) {
  console.error('F3F5_RUNTIME_EXPERIMENT_FAILED', e?.stack ?? String(e));
  for(const x of children) {
    try { console.error(`OWNED_${x.title}_TAIL`,readFileSync(x.logPath,'utf8').slice(-3500)); } catch {}
  }
  process.exitCode=1;
} finally {await cleanupOwned();}
