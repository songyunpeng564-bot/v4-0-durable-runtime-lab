import * as restate from '@restatedev/restate-sdk';
import { effectWithGuard,inputFor } from './effect-mitigations.mjs';
if(process.env.V4_MITIGATION_TEST!=='isolated-github-runner')throw Error('refuse_non_disposable');
const service=restate.service({name:'CrashMitigationSafety',handlers:{
  dispatch:async(ctx,input)=>{
    if(JSON.stringify(input)!==JSON.stringify(inputFor('restate',input?.mode)))
      throw new restate.TerminalError('invalid_test_input');
    return ctx.run('mitigated-effect',()=>effectWithGuard('restate',input));
  },
}});
restate.serve({services:[service],port:9083});
console.log('RESTATE_MITIGATION_WORKER_PORT=9083');
