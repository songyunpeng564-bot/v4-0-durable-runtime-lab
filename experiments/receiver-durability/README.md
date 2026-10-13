# V4-0 public synthetic downstream: PostgreSQL transactional idempotency

**Staged, NOT_RUN as a real PostgreSQL experiment until manually dispatched.**
This is an independent **downstream receiver** contract test following the real
DBOS/Restate crash-window trials (both replayed an external mock effect twice
without protection, both passed 4/4 when given test-only dedup or fail-closed UNKNOWN).
It deliberately does **not run DBOS, Restate, original V3, Codex, Promotion or Telegram**.

## Four runtime assertions (not yet proven on GitHub Actions)

1. **Crash after transaction commit, before HTTP receipt:** an owned receiver
   (port 9191, localhost) POSTs one synthetic effect and matching attempt in a
   real PostgreSQL transaction; after COMMIT, the receiver **self exits 73** without
   replying. Require process exit 73, client transport failure, and database
   evidence of exactly one committed effect and one recorded attempt.
2. **Restart and retry:** launch a fresh owned receiver process on that port,
   repeat the same immutable `operationId`. Require **2 attempts / 1 effect**,
   second response `duplicate:true`; PostgreSQL must outlive the worker.
3. **32 requests to two independent receiver processes:** 16 parallel requests
   to each process (ports 9191 and 9192) with a **second identical operation ID**.
   A PostgreSQL PRIMARY KEY with `INSERT .. ON CONFLICT DO NOTHING` must yield
   **32 attempts, exactly 1 committed synthetic effect**, 1 winner and 31
   duplicates. This is a shared database transactional constraint, not a Node
   in-memory `Set`.
4. **Mismatched payload key collision + persistent readback:** reuse the ID with
   a different synthetic stage. The receiver must return **409** and record the
   rejected attempt without committing another effect. Then stop all receiver
   processes, start a new one and verify the entire PostgreSQL attempt/effect
   ledgers through the new process. Expected total **35 attempts / 2 effects**.

The only external address is npm/GitHub for installing dependency and fetching
these immutable **public** files in the ephemeral runner. Runtime side effects
are HTTP requests to 127.0.0.1 plus PostgreSQL inserts in the disposable database.
The Actions workflow has **manual `workflow_dispatch` only**, opt-in default
false, `permissions: {}`, no `actions/checkout` and a 10-minute Ubuntu job limit.
Runtime checks reject non-Linux, non-GitHub-Actions, missing approval, wrong
synthetic PG URL, or workdir outside `RUNNER_TEMP`. Only test-owned child
processes are signaled or self-terminate; no process-name kill.

## What this cannot prove

- An actual Telegram Bot API message, git Promotion push, or external Codex
  effect **cannot be made exactly-once** merely by inserting a record in this
  PostgreSQL database. The test's mock effect and idempotency key are inside
  **the same database transaction**; external systems cannot be assumed to
  participate in that transaction.
- Does **not** prove PostgreSQL machine power-loss recovery, synchronous WAL
  replication, network partitions, multi-database atomic transactions,
  cross-region multi-master behavior, or downstream effect outside PostgreSQL.
- Does **not** prove Windows NTFS owner/reparse/IPC EOF protections, nor run
  the official original V3 or any of the historic 57 three-way comparisons.
- No framework selected and no production code/credentials/private data public.

**Acceptance is explicitly `NOT_RUN` until the Owner starts a NEW manual public
Actions workflow and the GM reads its real raw logs.** A failed test must remain
failed, with attempt/effect counts preserved; never adjust counts merely to
make the CI green.
