// Restate server stays alive while this owned SDK endpoint deliberately exits once.
import * as restate from '@restatedev/restate-sdk';
import { effectAndCrashBeforeStepResult, inputFor } from './crash-effect.mjs';
if (process.env.V4_CRASH_TEST_MODE !== 'isolated-github-runner') throw Error('not_disposable_runner');
const service = restate.service({
  name:'CrashWindowSafety',
  handlers: {
    dispatch: async (ctx,input) => {
      if (JSON.stringify(input) !== JSON.stringify(inputFor('restate')))
        throw new restate.TerminalError('invalid_synthetic_input');
      return ctx.run('external-effect-crash-before-durable-result',
        ()=>effectAndCrashBeforeStepResult('restate',input));
    },
  },
});
restate.serve({services:[service],port:9082});
console.log('RESTATE_CRASH_WORKER_PORT=9082');
