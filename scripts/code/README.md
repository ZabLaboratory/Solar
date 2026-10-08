# Code discovery and documentation integrity

Owner: Solar maintenance. `cli.mjs` derives the code index and answers path/symbol/owner
queries. `graph.mjs` follows public and HTML entrypoints, re-exports, imports and actual
Worker URLs. It separates product references from direct unit-test consumers. `documentation.mjs`
checks active local Markdown links, paths, headings, package commands and Solar script
references, including plain commands. Commands explicitly owned by another repository
are integration documentation and remain outside this local check.

Consumers: package `code:*`, `check:source-usage`, `check:docs` and architecture checks.
The index is derived from source; domain README ownership and integration intent remain curated.
TypeScript/eslint still check unused locals and parameters. The graph does not certify arbitrary
runtime branches, upstream internals or the existence of remote services.

Run `npm run code:map` after source changes, then `npm run check:architecture`.
`npm run code:read -- native-state` and `npm run code:find -- camera` show current records.
Negative tooling tests cover unreachable/test-only exports, Worker edges and documentation drift.
The existing pull-request/main file-size workflow and release workflow run the architecture
checks and their negative tests. Workflow edits are locally reviewed; remote CI results
require publication of the candidate.
