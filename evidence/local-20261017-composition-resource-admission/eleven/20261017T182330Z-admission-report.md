# Solar native composition resource admission

Base: `e8ca9a3a6944fac68430fa9ddb79b93366a2f99a`, branch
`eleven/local-20261017-composition-resource-admission`.

Prism declares `solar/composition` with type `solar.native-composition/1` and the
empty `/1` state seed. Before the fix, the focused receiver unit test failed with
`LSDP_RESOURCE_INVALID` (1 failed, 2 passed). Solar now admits that exact type and
target, validates its seed and full replacements with the publisher's existing
state-envelope contract, and retains Rust's read, watch, atomic apply, hash
precondition, and declared-seed recovery behavior. Other arbitrary types and a
composition type on another target remain rejected.

The emitted `solar.host.v2` contract includes
`solar.native-composition.resource.v1`. Its package check rejects the otherwise
complete old v2 contract when only that capability is missing. A real negative
check of the built contract returned exit 1 and the expected diagnostic; the
contract was restored byte-for-byte (SHA-256
`6e6d258da345365c13e37ab03b1d3b4c501e42b99b653a7a61a53711af7d3bc5`)
and the bundle check passed again.

Validation from this worktree:

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:bundle`,
  and `npm run check:architecture`: pass.
- `npm run test:architecture`: 12/12 pass, including the old-contract negative.
- `npx vitest run --maxWorkers=2`: 49 files, 485/485 pass. An earlier concurrent
  default-worker run had a 5-second timeout in `scene-library` (484/485 passed);
  that file passed isolated in 2.1 seconds before the bounded full rerun.
- [Native receiver proof](20261017T182330Z-native-composition-reception.json):
  10 checks against the real `lsdpd` binary, including claim, replace, stale
  precondition, watch, child-loss recovery, seed reset, same endpoints, and owned
  child reaping. Binary SHA-256
  `083f06c25248f2ca3f2523f41c966012499bce77cc68117c6b12de160bf93448`;
  built server SHA-256
  `59b10068e9a1ba775fbb5e120562d79adc6e1a3eb5579cbd80a1b3d78decf6eb`.
  Both owned `lsdpd` PIDs were absent after the run.

This CPU-only proof establishes Solar's receiver and package contract. Prism's
installed bootstrap and the Vision/CEF/native render chain remain separate
integration checks; no Prism, Pulsar, renderer, or GPU was launched here.
