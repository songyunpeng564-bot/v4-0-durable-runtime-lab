// Never sends to external hosts. Loss of a response is ALWAYS unknown, never success.
const ENDPOINT = 'http://127.0.0.1:9186/effect';
const stages = new Set(['codex', 'promotion', 'telegram']);
const frameworks = new Set(['dbos', 'restate']);
export async function attemptEffect(input) {
  if (!input || !stages.has(input.stage) || !frameworks.has(input.framework) ||
      !/^[a-z0-9][a-z0-9_-]{7,63}$/.test(input.operationId) ||
      !['ack', 'drop_ack'].includes(input.mode)) {
    throw new Error('invalid_synthetic_input');
  }
  const base = { framework: input.framework, stage: input.stage, operationId: input.operationId };
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...base, mode: input.mode }),
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) return { ...base, status: 'OUTCOME_UNKNOWN', reason: 'unconfirmed_response' };
    const data = await response.json();
    if (data?.status === 'ACK_CONFIRMED' && data?.operationId === base.operationId) {
      return { ...base, status: 'ACK_CONFIRMED', reason: 'response_matches_operation' };
    }
    return { ...base, status: 'OUTCOME_UNKNOWN', reason: 'invalid_ack' };
  } catch {
    return { ...base, status: 'OUTCOME_UNKNOWN', reason: 'ack_lost_or_unavailable' };
  }
}
