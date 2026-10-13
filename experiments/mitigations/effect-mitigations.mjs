// Explicit application guards; NOT a framework-supplied exactly-once guarantee.
import { existsSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
const frameworks=new Set(['dbos','restate']);
const modes=new Set(['dedup','unknown']);
const root=()=>process.cwd();
export function inputFor(framework,mode) {
  if(!frameworks.has(framework)||!modes.has(mode))throw Error('bad_test_identity');
  return {framework,mode,operationId:`v4_${framework}_${mode}_crash_01`};
}
function persistOnce(path,data){
  const fd=openSync(path,'wx',0o600);
  try{writeSync(fd,data+'\n');fsyncSync(fd);}finally{closeSync(fd);}
}
export async function effectWithGuard(framework,input){
  if(process.env.V4_MITIGATION_TEST!=='isolated-github-runner'||
    JSON.stringify(input)!==JSON.stringify(inputFor(framework,input?.mode)))throw Error('unsafe_input');
  const intent=join(root(),`app-intent-${input.operationId}.json`);
  const crashMark=join(root(),`crash-once-${input.operationId}.marker`);
  // Conservative app journal: if our process might already have dispatched and
  // the downstream cannot be queried, block; do NOT send a second request.
  if(input.mode==='unknown'){
    if(existsSync(intent)) return {...input,status:'OUTCOME_UNKNOWN',reason:'unqueryable_previous_dispatch'};
    persistOnce(intent,JSON.stringify({operationId:input.operationId,state:'INTENT_BEFORE_EXTERNAL_EFFECT'}));
  }
  const r=await fetch('http://127.0.0.1:9187/effect',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),
    signal:AbortSignal.timeout(4000),
  });
  if(!r.ok)throw Error(`synthetic_receiver_${r.status}`);
  const receipt=await r.json();
  if(receipt.status!=='ACK_CONFIRMED'||receipt.operationId!==input.operationId||
     typeof receipt.duplicate!=='boolean')throw Error('invalid_synthetic_receipt');
  if(!existsSync(crashMark)){
    persistOnce(crashMark,`ACK_BEFORE_STEP_RESULT ${input.operationId}`);
    console.log(`MITIGATION_EFFECT_ACK_BEFORE_SELF_EXIT mode=${input.mode} framework=${framework} code=73`);
    process.exit(73); // only test-owned child process
  }
  return {...input,status:'ACK_CONFIRMED',duplicate:receipt.duplicate};
}
