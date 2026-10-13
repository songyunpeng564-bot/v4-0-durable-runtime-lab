# V4-0 true process-exit crash-window diagnostic (public synthetic-only)

This is NOT production code and cannot be used on Owner Windows/V3. It is a
*manual-only* experiment to check what genuine DBOS v5.2.11 and Restate Server
1.7.13 / SDK 1.17.3 do when an owned ephemeral worker **exits with code 73
inside its step callback** after a localhost mock effect has been fsynced and
ACKed, but before that callback returns its result to the framework journal.

Scope is two tests: one DBOS and one Restate, both the same synthetic
`telegram`-labelled (NOT real Telegram) operation with a distinct stable ID.
Each uses a non-deduplicating, independent localhost receiver from the
previously reviewed F3–F5 public experiment. The receiver and PostgreSQL or
Restate server stay alive when the owned application worker exits. The worker
is then restarted once using the same durable identity. All files and state
live only under `$RUNNER_TEMP`, on a fresh GitHub-hosted Ubuntu runner.

Safety/acceptance:
- `CRASH_INJECTION_CONFIRMED` requires exact worker exit 73, crash marker, and
  exactly ONE fsynced receiver effect before restarting.
- `CRASH_RESULT framework=... class=UNSAFE_DUPLICATE` if the receiver records
  a second effect. This makes the run FAIL, not PASS; no fabricated dedup.
- `RECOVERY_UNCONFIRMED` is also a failure: zero repeats is insufficient if
  the workflow never demonstrably resumed.
- `RECOVERED_SINGLE_EFFECT` requires proven completion and only one effect.
- The crash marker exists only to prevent an infinite sequence of test
  process exits. It is NOT an application idempotency design; it never
  skips the external call on restart.
- The experiment uses `workflow_dispatch` default false, 10-minute standard
  public runner, no repository checkout or secrets, no production APIs,
  no system PIDs/Windows power-loss/junction/signal injection.
- Exact SDK APIs are based on prior real bootstrap and F3–F5 registered
  workflow runs. Compatibility on a fresh run is NOT YET VERIFIED.

A passing result is only scoped to this precise Ubuntu test and two synthetic
operations. A failing result is meaningful evidence of an unsafe external-effect
window, not proof that a framework itself is globally unsuitable. Never claim
actual Telegram exactly-once or real original V3 behavior from these results.

This experiment is deliberately separate from the original Windows P0 0/6
NOT_RUN and historical three-way 57-case comparison NOT_RUN.
