// Real Restate SDK service; only acts on a deterministic localhost synthetic receiver.
import * as restate from '@restatedev/restate-sdk';
import { attemptEffect } from './effect-client.mjs';
const service = restate.service({
  name: 'SyntheticSafety',
  handlers: {
    dispatch: async (ctx, input) => {
      if (input?.framework !== 'restate') throw new restate.TerminalError('wrong_framework');
      // Catch the HTTP transport exception INSIDE ctx.run before Restate can retry it.
      return ctx.run('external-effect-with-fail-closed-receipt', () => attemptEffect(input));
    },
  },
});
restate.serve({ services: [service], port: 9080 });
console.log('RESTATE_SYNTHETIC_SERVICE_LISTENING=9080');
