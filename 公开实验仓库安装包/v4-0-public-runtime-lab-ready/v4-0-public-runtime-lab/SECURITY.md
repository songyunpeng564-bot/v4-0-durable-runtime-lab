# Public-source safety boundary

All content in this repository is PUBLIC. Never upload personal profiles, conversation transcripts, internal code, real tokens, local project paths, Telegram IDs, private GitHub repository clones or real business payloads.

The workflow uses only ephemeral, synthetic PostgreSQL credentials on a temporary GitHub-hosted runner. They are not reusable credentials. There is no actions/checkout step and no repository token permissions. Package installs access the official npm registry and GitHub-hosted runner networking; those are not production services.

The workflow only performs real runtime bootstrapping. It does not conduct F1–F8 fault tests or handle production resources. Failure to start either runtime must be reported as BLOCKED / NOT_RUN for the missing runtime, not converted to a passing experiment.

Do not change visibility of any existing private repository. Do not add secrets or link the public laboratory to private production workflows.
