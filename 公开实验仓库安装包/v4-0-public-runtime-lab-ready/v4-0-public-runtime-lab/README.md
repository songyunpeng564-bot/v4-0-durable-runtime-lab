# Durable runtime public synthetic laboratory

A **standalone, public, synthetic-only** experiment to bootstrap two actual TypeScript durable-execution runtimes on an ephemeral GitHub-hosted Linux runner:

- DBOS TypeScript, using a disposable PostgreSQL service container.
- Restate Server v1.7.13 and Restate TypeScript SDK, using only a loopback TCP readiness check.

## Scope

This repo contains **no private business code, no real AI Studio files, no personal data and no credentials**. The workflow deliberately does **not** run `actions/checkout`, and GitHub Token permissions are empty. No outbound business calls, Telegram messages or actual workflow fault injection are run.

**Do not upload or copy material from a private repository, secrets, test fixtures containing user data, historical project logs or production configuration.** Only the four original files in the accompanying preflight package belong here.

## Run authorization

The workflow `.github/workflows/runtime-bootstrap.yml` is `workflow_dispatch` **only**, has a mandatory boolean input that defaults to **false**, and runs on a standard `ubuntu-24.04` GitHub-hosted runner with a ten-minute job timeout. It uses a public-repository standard runner to avoid drawing from private repository Actions minutes, subject to current GitHub plan and billing rules. Manual confirmation is required for each run.

When the repository is created and files are uploaded, open **Actions → Public synthetic DBOS and Restate runtime bootstrap → Run workflow**, select the default branch and check the explicit `run_synthetic_bootstrap` input. Inspect logs to decide whether each runtime actually started. A listener and SDK import **do not** prove crash recovery or exactly-once external effects.

## Experimental truth

Before the first run: `DBOS=NOT_RUN`, `RESTATE=NOT_RUN`, `F1–F8=NOT_RUN` for real contender comparison. A successful bootstrap only proves SDK/DBOS/Postgres initialization and Restate process local port readiness, not the durable workflow fault tests.

Vendor references:
- https://docs.dbos.dev/typescript/integrating-dbos
- https://docs.dbos.dev/typescript/reference/dbos-class
- https://github.com/restatedev/restate
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
