# UK AQ website coding-agent rules

This file is the active repository-level agent instruction set. `AGENTS_BASE.md` is retained as older reference material and is **not** a mandatory/default read. Where it differs, this file and active `system_docs/` contracts take precedence.

## Scope and authority

- This is the TEST public website implementation repository. Do not inspect, modify or copy changes to LIVE unless the user explicitly asks for LIVE work.
- For website-only implementation, work here after selecting the relevant system contract.
- Before implementation read:
  1. this file;
  2. `../TEST-uk-aq-system-docs/system_docs/SYSTEM_OVERVIEW.md`;
  3. the relevant website/data area `README.md`;
  4. only the broad/narrow contracts selected by that router;
  5. the website files actually in scope.
- Use `website_ui/README.md` for page/presentation behaviour and `website_deployment/README.md` for Pages artefact/cache-busting/deployment-time asset identity. Add data-area contracts only when the task changes their semantics.
- Active `system_docs/` contracts are authoritative. Report conflicts rather than silently overriding them.
- Coding agents may read `system_docs/` but MUST NOT edit/move/rename/delete it. Provide a concise Chat-mode documentation handover when implementation requires contract updates.

## Default operating mode

Default is focused TEST website code implementation.

Unless explicitly requested, do **not**:

- create/amend commits, push, create branches or PRs;
- deploy Pages, Workers or workflows;
- run SQL, migrations, backfills or other external data operations;
- modify Cloudflare, Supabase, R2, GitHub or other external settings;
- make changes in LIVE repositories.

When deployment/external action is required but not authorised, make repository changes only and provide exact manual commands, expected result, rollback notes and real TEST validation steps.

## Validation policy

Before deployment, run only the smallest fast local structural checks required by the changed HTML/CSS/JavaScript/configuration, such as syntax/parsing or one directly relevant deterministic check.

Do not create new automated frontend suites, broad screenshot matrices or exhaustive viewport programmes by default. Add a targeted pre-deployment check only when the specific change genuinely requires it.

Functional/visual validation happens after deployment through real TEST pages and representative affected widths/interactions.

## Archive safety

- `Archive/` paths are retired for active execution and asset references. Active HTML/CSS/JavaScript MUST NOT fall back to archived files.
- Before a substantial or high-risk change to active non-test implementation code, preserve the exact pre-change in-scope code under the repository's existing dated `Archive/YYYY-MM-DD/` convention, preserving relative paths where practical.
- Archive each code file at most once per calendar day and reuse today's copy.
- Do not create code-style archive copies for documentation, tests/fixtures/test data, generated outputs, images/assets or other non-code files.
- Archive copies are reference/rollback only and MUST NOT be modified or referenced by active pages/tests/assets.

## Behaviour boundaries

- Do not duplicate API, AQI, WHO, Latest Snapshot, R2-history or cache semantics in website code merely to simplify a presentation change. Follow the relevant active data/system contract.
- Preserve shared modules/state owners defined by the active website contracts rather than creating desktop/mobile or page-local competing implementations.
- Public route/field/meaning changes require the owning system contract; presentation-only work must not silently alter data meaning.

## Reporting

After implementation report:

- files changed;
- relevant contract behaviour changed or preserved;
- structural checks run;
- manual deployment commands if required;
- post-deployment real TEST visual/operational validation;
- rollback implications;
- system-doc handover needed, if any.

If no implementation files changed, say so.

## Search

Prefer `grep` for text search/file discovery; do not use `rg` unless explicitly requested.
