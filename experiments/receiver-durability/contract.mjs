import { createHash } from 'node:crypto';

export const SPEC = Object.freeze({
  crash: Object.freeze({ operationId: 'v4_receiver_crash_01', stage: 'synthetic_codex' }),
  parallel: Object.freeze({ operationId: 'v4_receiver_parallel_01', stage: 'synthetic_promotion' }),
});

const allowedStages = new Set(['synthetic_codex', 'synthetic_promotion', 'synthetic_changed']);
const allowedIds = new Set(Object.values(SPEC).map(x => x.operationId));
export function validRequest(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.keys(v).sort().join(',') === 'operationId,stage,trigger' &&
    allowedIds.has(v.operationId) && allowedStages.has(v.stage) &&
    (v.trigger === 'crash' || v.trigger === 'none') &&
    (v.trigger !== 'crash' || (v.operationId === SPEC.crash.operationId && v.stage === SPEC.crash.stage));
}
export function contentHash(stage) {
  if (!allowedStages.has(stage)) throw Error('invalid_stage');
  return createHash('sha256').update(JSON.stringify({stage})).digest('hex');
}
export function isolatedRunner(env = process.env, platform = process.platform) {
  return platform === 'linux' && env.GITHUB_ACTIONS === 'true' &&
    env.V4_RECEIVER_APPROVED === 'yes' &&
    env.PGURL === 'postgresql://synthetic_user:synthetic_local_only@127.0.0.1:5432/synthetic_v4_db' &&
    typeof env.RUNNER_TEMP === 'string' && env.RUNNER_TEMP.length > 0;
}
