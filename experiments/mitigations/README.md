# V4-0: synthetic business-safety mitigation for durable workflow replay

Manual-only **genuine** DBOS 5.2.11 and Restate 1.7.13/SDK 1.17.3
worker-crash tests. No actual Telegram, Codex, Promotion, private repo files,
secrets, or Windows processes. All processes and journals are disposable and
live under a single GitHub Actions hosted runner's RUNNER_TEMP.

This is the **follow-up to** a real crash-before-step-result test that returned
`UNSAFE_DUPLICATE effects=2 completed=true` for **each** framework. A workflow
engine may replay a step after the external effect happens but before a step
result is durable. The solution belongs at the **business-effect boundary**.

Four cases (DBOS/Restate x two mitigation styles):

- `dedup`: same operationId sent twice, the test receiver logs **2 attempts**;
  it processes the effect only on the first request, logs **1 committed effect**,
  and acknowledges the second request as a duplicate.
- `unknown`: before first send the application durably writes an `INTENT`.
  After one effect and owned worker exit(73), recovery sees an undecidable prior
  dispatch and **does not issue a second POST**. It returns `OUTCOME_UNKNOWN`;
  independent observer still sees **1 attempt, 1 effect**. This sacrifices
  automatic completion to avoid an unsafe blind retry.

All cases must prove exit 73 after the first ACK, original stable operationId,
framework durable recovery, successful return `ACK_CONFIRMED` or explicit
`OUTCOME_UNKNOWN`, and independently fsynced attempt/effect ledgers. Expected
final **six request attempts, four committed synthetic effects**. Do not change
expected counters to hide failures. On any mismatch the Action must be FAILED,
never silently green. Runtime execution is **NOT_RUN until Owner manually runs**.

**Limitations:** The receiver uses single-process serialized synchronous append
and fsync; it is *not* a proof of multi-host atomic idempotency, concurrent
process lease safety, receiver power loss, database atomic transaction with an
external system, genuine Telegram platform support for idempotency or
queryable send receipts. `unknown` uses a single disposable runner's local
INTENT file, and depends on its fsync+path integrity; production Windows
permissions/ACLs/reparse/power-loss are NOT tested. The `INTENT` can cause
conservative blocking even if no effect was actually dispatched. No actual
original V3 source is executed or copied into this public repository.

F1–F8 and original Windows P0 0/6, historic 57-case three-way parity: NOT_RUN.
V4-0 architecture selection remains OPEN and V4-A NOT_STARTED.
