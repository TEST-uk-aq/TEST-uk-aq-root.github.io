# Agent Notes

## Main Repo

- `TEST-uk-aq-ops` is the main repo for this project and the default starting point for cross-repo work.
- Ops repo path: `/Users/mikehinford/Dropbox/Projects/UK-AQ Website & Network/TEST UK-AQ GH Repos/TEST-uk-aq-ops`.
- `TEST-uk-aq-root.github.io` is the website implementation repo and the starting point for website-only file changes after any required cross-repo context is established in ops.
- Website repo path: `/Users/mikehinford/Dropbox/Projects/UK-AQ Website & Network/TEST UK-AQ GH Repos/TEST-uk-aq-root.github.io`.

- Do not inspect or modify any `LIVE` repo unless the user explicitly asks.
- Do not manually copy changes to a live UK-AQ website repo unless the user explicitly asks for that repo to be changed.

## Codex operating mode
Default mode is code-only implementation.
Codex should:
- make focused code, schema, documentation, and test edits requested by the task;
- run only fast, local, non-destructive checks needed to verify the edit;
- provide a clear manual validation and deployment plan;
- include exact SQL, gcloud, wrangler, GitHub Actions, and Supabase commands for the user to run manually.
Codex must not, unless explicitly asked:
- run SQL against live/test Supabase databases;
- apply migration files;
- deploy Cloud Run services, Workers, or GitHub Actions workflows;
- run backfills, reconciliations, bulk jobs, or long-running data jobs;
- run broad external API fetches;
- repeatedly inspect cloud logs;
- make operational changes in GCP, Supabase, Cloudflare, R2, Dropbox, or GitHub settings.
When database or deployment work is needed, Codex should stop after producing:
1. files changed,
2. tests run,
3. exact manual commands,
4. expected outputs,
5. rollback notes,
6. post-deploy validation checklist.

## Permission levels
Unless the prompt says otherwise, use Level 1.
### Level 1 — Code only
Edit files and run small local/static tests. Do not touch external services or databases.
### Level 2 — Local validation
Level 1 plus local-only scripts/tests that do not call Supabase, GCP, Cloudflare, R2, Dropbox, or external APIs.
### Level 3 — Assisted operations
Prepare SQL, deploy commands, and validation commands, but do not run them.
### Level 4 — Execute operations
Only when explicitly requested in the prompt. May run database, deployment, or cloud commands.

## Archive Execution Policy

- Archive paths are retired for active execution.
- Active HTML, CSS, JavaScript, and asset references must only target non-archive paths.
- Do not add `Archive/` fallbacks to active website paths.

### Pre-change Archive Requirement

* Archive snapshots are restricted to active, non-test implementation code.
* Never create archive copies for documentation, including anything under `system_docs/`, tests, test fixtures, snapshots, test data, generated outputs, assets, or other non-code files.
* Before making a substantial or high-risk change to active non-test code, archive the current version of every in-scope code file that is expected to be changed.
* Archive copies must be placed under a dated directory inside `Archive/`, using today’s date in `YYYY-MM-DD` format.
* Preserve the original relative path of each archived code file inside that dated archive directory where practical, so the archived copy can be traced back to its source location.
* If additional active non-test code files are discovered during the work and need to be changed, archive those files before changing them.
* A code file only needs to be archived once per calendar day. If the same file has already been archived in today’s archive directory, do not create another duplicate archive copy for that file.
* Files excluded from archive snapshots rely on Git history and the project’s daily backups.
* Archive copies are for reference and rollback only. Do not reference archive paths from active HTML, CSS, JavaScript, tests, or asset paths.
* Do not modify archived copies after they have been created, except to correct an accidental archive-path mistake before the main code change proceeds.

## Implementation Reporting

- When changing code, schema, workflows, or config, always include clear implementation steps in the response.
- Implementation steps must state what changed, which files were changed, and any required apply/deploy/run commands.
- If no code changes were made, state that explicitly.

## Search Tool Preference
- Prefer `grep` for text search and file discovery; do not use `rg` unless explicitly requested.
