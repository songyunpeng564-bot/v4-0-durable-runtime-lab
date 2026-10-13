// Synthetic-only, loopback-only. The effect is fsynced externally before we exit.
import { openSync, closeSync, fsyncSync, writeSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STAGE = 'telegram';
const ID = framework => `v4_${framework}_telegram_crash_01`;
const MARK = framework => join(process.cwd(), `crash-once-${framework}.marker`);
export function inputFor(framework) {
  if (!['dbos', 'restate'].includes(framework)) throw Error('invalid_framework');
  return Object.freeze({framework, stage: STAGE, operationId: ID(framework), mode: 'ack'});
}
export async function effectAndCrashBeforeStepResult(framework, input) {
  if (process.env.V4_CRASH_TEST_MODE !== 'isolated-github-runner' ||
      JSON.stringify(input) !== JSON.stringify(inputFor(framework))) throw Error('unsafe_experiment_input');
  const response = await fetch('http://127.0.0.1:9186/effect', {
    method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(input),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw Error(`synthetic_receiver_status_${response.status}`);
  const ack = await response.json();
  if (ack?.status !== 'ACK_CONFIRMED' || ack.operationId !== input.operationId) throw Error('synthetic_receipt_not_confirmed');
  // This marker is test-only, not a business idempotency key. It prevents infinite test crashes,
  // but deliberately DOES NOT stop the next invocation from making another external effect.
  if (!existsSync(MARK(framework))) {
    const fd = openSync(MARK(framework), 'wx', 0o600);
    try { writeSync(fd, `ack-observed-for=${input.operationId}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    writeSync(1, `TEST_EFFECT_ACK_RECEIVED_THEN_SELF_EXIT framework=${framework} code=73\n`);
    // Exits INSIDE the DBOS/Restate step callback, before that callback can return a value.
    process.exit(73);
  }
  return {status:'ACK_CONFIRMED', operationId:input.operationId, framework, stage:STAGE};
}
