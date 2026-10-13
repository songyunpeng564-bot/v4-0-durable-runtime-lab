// Only this owned disposable Node worker exits itself. Postgres survives for recovery.
import { DBOS } from '@dbos-inc/dbos-sdk';
import { writeFileSync, openSync, closeSync, fsyncSync, writeSync } from 'node:fs';
import { effectAndCrashBeforeStepResult, inputFor } from './crash-effect.mjs';

const expectedDb = 'postgresql://synthetic_user:synthetic_local_only@127.0.0.1:5432/synthetic_v4_db';
if (process.env.DBOS_SYSTEM_DATABASE_URL !== expectedDb || !['first','recover'].includes(process.env.V4_WORKER_ROLE))
  throw Error('invalid_isolated_dbos_worker');
const workflow = DBOS.registerWorkflow(async input =>
  DBOS.runStep(() => effectAndCrashBeforeStepResult('dbos', input), {name:'crash-window-effect'}),
  {name:'v4CrashWindowWorker'});
DBOS.setConfig({ name:'v4-public-crash-test', applicationVersion:'0.0.4', systemDatabaseUrl:expectedDb });
const identity = inputFor('dbos');
let launched = false;
try {
  await DBOS.launch(); launched = true;
  writeSync(1, `DBOS_WORKER_LAUNCHED role=${process.env.V4_WORKER_ROLE}\n`);
  const handle = process.env.V4_WORKER_ROLE === 'first'
    ? await DBOS.startWorkflow(workflow, {workflowID:identity.operationId})(identity)
    : await DBOS.retrieveWorkflow(identity.operationId);
  if (!handle) throw Error('dbos_recovery_handle_missing');
  const result = await Promise.race([
    handle.getResult(),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('dbos_recovery_timeout')),20000)),
  ]);
  if (process.env.V4_WORKER_ROLE === 'first') throw Error('first_worker_should_have_exited_73');
  const out = JSON.stringify(result);
  const fd = openSync('dbos-recovery-result.json','wx',0o600);
  try {writeSync(fd,out);fsyncSync(fd);} finally {closeSync(fd);}
  writeSync(1, `DBOS_RECOVERY_RESULT=${out}\n`);
} catch(e) {
  console.error('DBOS_WORKER_ERROR',e?.stack||String(e));
  process.exitCode=1;
} finally {
  if (launched) await DBOS.shutdown().catch(e=>console.error('DBOS_SHUTDOWN_WARN',String(e)));
}
