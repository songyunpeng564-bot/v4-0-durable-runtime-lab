import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEC, validRequest, contentHash, isolatedRunner } from './contract.mjs';
const req=(operationId,stage,trigger='none')=>({operationId,stage,trigger});
const env={GITHUB_ACTIONS:'true',V4_RECEIVER_APPROVED:'yes',PGURL:'postgresql://synthetic_user:synthetic_local_only@127.0.0.1:5432/synthetic_v4_db',RUNNER_TEMP:'/tmp/test-runner'};
test('two fixed public synthetic operation IDs are accepted',()=>{
  assert.equal(validRequest(req(SPEC.crash.operationId,SPEC.crash.stage,'crash')),true);
  assert.equal(validRequest(req(SPEC.parallel.operationId,SPEC.parallel.stage)),true);
});
test('collision attempt stays syntactically valid so DB detects semantic mismatch',()=>{
  assert.equal(validRequest(req(SPEC.parallel.operationId,'synthetic_changed')),true);
  assert.notEqual(contentHash(SPEC.parallel.stage),contentHash('synthetic_changed'));
});
test('non-synthetic and malformed inputs are rejected',()=>{
  assert.equal(validRequest({...req(SPEC.crash.operationId,SPEC.crash.stage),secret:'x'}),false);
  assert.equal(validRequest(req('production_user_1',SPEC.crash.stage)),false);
  assert.equal(validRequest(req(SPEC.parallel.operationId,SPEC.parallel.stage,'crash')),false);
  assert.equal(validRequest(null),false);
  assert.equal(validRequest(req(SPEC.parallel.operationId,'telegram_real')),false);
});
test('trigger is not part of business identity',()=>{
  assert.equal(contentHash(SPEC.crash.stage),contentHash(SPEC.crash.stage));
  assert.match(contentHash(SPEC.crash.stage),/^[0-9a-f]{64}$/);
});
test('local machines and missing approval are rejected',()=>{
  assert.equal(isolatedRunner(env,'linux'),true);
  assert.equal(isolatedRunner({...env,V4_RECEIVER_APPROVED:'no'},'linux'),false);
  assert.equal(isolatedRunner(env,'win32'),false);
  assert.equal(isolatedRunner({...env,PGURL:'postgresql://prod'},'linux'),false);
});
