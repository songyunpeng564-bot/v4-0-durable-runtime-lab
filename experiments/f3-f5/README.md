# F3–F5: first REAL registered workflow and service trial (synthetic effects)

All source in this folder is PUBLIC and intentionally contains no V3 source, keys,
real Telegram, promotion or Codex operations. A real DBOS registered Workflow +
PostgreSQL and a real Restate registered Service are driven against an independent
localhost-only Node HTTP receiver that fsyncs an append-only synthetic effect record
*before* intentionally destroying the response socket.

Expected in the GitHub Actions public workflow logs:
- `RESTATE_REAL_SERVICE_REGISTRATION=PASS`
- `DBOS_REAL_REGISTERED_WORKFLOW=PASS`
- six `F3F5_CASE_PASS ... status=OUTCOME_UNKNOWN effects=1` rows for DBOS and Restate
  times three stage labels (`codex`, `promotion`, `telegram`)
- `F3F5_REAL_WORKFLOW_6_OF_6_PASS=TRUE` and exactly 6 independent effect records.

Proof boundary: this is one-shot **dropped ACK without process crash**. A caught HTTP
error returns `OUTCOME_UNKNOWN` *inside* the framework's durable step. It does NOT
prove framework ability to handle a crash between external effect and result journal
persistence; that is separately NOT_RUN. Neither framework is inherently exactly once
for arbitrary external side effects. The receiver stores each attempt, not an
idempotent/deduplicated fake: any unsafe replay would create extra records.

The workflow is manually dispatched only and uses a 10-minute standard GitHub-hosted
Ubuntu runner, Postgres17-alpine, SDK pins from prior successful bootstrap:
DBOS 5.2.11, Restate Server 1.7.13, SDK 1.17.3. The workflow does not checkout any
repository or access private/production repos; it fetches only these exact public
source paths from its own immutable `github.sha` commit.

No Windows fault, recovery/reboot, multiwriter lease, real F1–F8 parity, 57 historical
comparisons or original V3 program has been run in this experiment.
