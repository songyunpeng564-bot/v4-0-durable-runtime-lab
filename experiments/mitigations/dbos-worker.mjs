import { DBOS } from '@dbos-inc/dbos-sdk';
import { openSync,writeSync,fsyncSync,closeSync } from 'node:fs';
import { effectWithGuard,inputFor } from './effect-mitigations.mjs';
const expectedDb='postgresql://synthetic_user:synthetic_local_only@127.0.0.1:5432/synthetic_v4_db';
const mode=process.env.V4_MODE, role=process.env.V4_WORKER_ROLE;
if(process.env.DBOS_SYSTEM_DATABASE_URL!==expectedDb || !['dedup','unknown'].includes(mode) ||
   !['first','recover'].includes(role) || process.env.V4_MITIGATION_TEST!=='isolated-github-runner')throw Error('refuse_non_disposable');
const workflow=DBOS.registerWorkflow(async input=>DBOS.runStep(()=>effectWithGuard('dbos',input),
  {name:'mitigated-effect'}),{name:'v4MitigationsTest'});
DBOS.setConfig({name:'v4-public-mitigations',applicationVersion:'0.0.6',systemDatabaseUrl:expectedDb});
let started=false;
try {
  await DBOS.launch();started=true;
  console.log(`DBOS_MITIGATION_WORKER_STARTED role=${role} mode=${mode}`);
  const input=inputFor('dbos',mode);
  const handle=role==='first'
    ? await DBOS.startWorkflow(workflow,{workflowID:input.operationId})(input)
    : await DBOS.retrieveWorkflow(input.operationId);
  if(!handle)throw Error('missing_original_workflow');
  const result=await Promise.race([handle.getResult(),new Promise((_,rej)=>setTimeout(()=>rej(Error('workflow_timeout')),22000))]);
  if(role==='first')throw Error('first_did_not_exit');
  const receipt=JSON.stringify(result);
  const fd=openSync(`dbos-result-${mode}.json`,'wx',0o600);
  try{writeSync(fd,receipt);fsyncSync(fd);}finally{closeSync(fd);}
  console.log(`DBOS_MITIGATION_RECOVERY_RESULT=${receipt}`);
}catch(e){console.error('DBOS_MITIGATION_WORKER_ERROR',e?.stack||String(e));process.exitCode=1;}
finally{if(started)await DBOS.shutdown().catch(e=>console.error('DBOS_SHUTDOWN_WARN',String(e)));}
