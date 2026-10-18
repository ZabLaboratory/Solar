# Solar v2 release contract qualification

- Source: Solar `7992ec825329f2f1eea7dc545d889662efde549f` plus the release-manifest correction in this worktree.
- `npm ci --no-audit --no-fund`: passed.
- `npm run build` and `npm run check:bundle`: passed; the built host exposes `solar.host.v2`, camera routing readback, and native composition.
- `node --test tests/tooling/host-contract.test.mjs`: 3/3 passed, including a generated release manifest and rejection of an incompatible packaged host.
- `npm run test:architecture`: 13/13 passed; `npm run check:architecture` and `npm run typecheck`: passed.
- Prism's local archive generated from this Solar build: `solar-local.tgz` SHA-256 `00146cacd1457a83952bfdd2368efd355d4d4c2e42d7c73e07c3e992c92eb0a2`, Windows native receiver present.

The local archive is an integration input, not a published Solar release. The public Solar release workflow also requires a Linux native receiver, which has not yet been supplied or qualified here. The Prism installer must pass a clean-profile Studio startup before publication.
