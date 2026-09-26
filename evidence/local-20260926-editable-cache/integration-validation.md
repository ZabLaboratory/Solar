# Solar — optimized Lumencast integration and rendered regression

This supplements validation.md's target-cache CPU/DOM benchmark. All changes
remain in the local `codex/solar-editable-cache` worktree; no package release,
push, merge, deployment or Pulsar modification/launch was performed.

## Actual runtime inputs

Both dependency variants were exercised:

1. Locked registry `@lumencast/runtime@0.18.2`, installed with `npm ci --offline`.
2. Exact local optimized runtime artifact, also numbered 0.18.2, SHA-256
   `e838f984a3d532e88f60dcb77c0079d8a326b986aa141529b067b88176504b99`.
   Source `977aaeb5d918c5d6b05b5a5368451533b7b36493`; its packages/runtime tree
   equals merged Lumencast `5b1279d5a03265716a6744d616330471445126bf`.

The exact archive was recovered from
`C:/Users/Mathias/AppData/Local/Temp/lumencast-runtime-integration-20260924.tgz`.
Install over locked dependencies with `npm install --no-save --ignore-scripts
--offline <archive>`, then run `node scripts/patch-lumencast-protocol.mjs`.
Only one dependency package changed; package.json/package-lock.json did not.
The worktree is left installed and built with this optimized candidate.

The readable packaged mount module was checked for snapshotEpoch,
sceneTransition and preloadRosterImages. A clean registry install cannot select
these newer source changes: a separate versioned release/integration remains
necessary before claiming they are shipped to users.

## Checks

- Exact optimized artifact: **32 unit files / 201 tests passed**, lint,
  typecheck, library/host build, bundle-size/no-bare-import checks passed.
- Final host size: 497,773 B raw / 163,053 B gz across all JS chunks.
- Registry and optimized artifact: **4/4 real Chrome host tests passed** on
  each; the optimized artifact was restored and its build/checks/E2E passed again.
- File-size guard: 108 text files, 2 reviewed exceptions, no growth; diff check
  passed. No assertion, resource allowlist or existing size limit was relaxed.

## Real render proof (new test)

`tests/e2e/host-bundle.spec.ts` now loads the built Solar host and actual packaged
Lumencast in Chrome, decodes an image, waits for fonts, applies the same accepted
image/text/position patches through the sideband and LSDP delta, and compares
its PNG to a fresh page receiving that final state as a snapshot. It also checks
the exact PNG after the 1.25 s convergence lease expires. An initial image count
assertion prevents an empty/missing-image comparison from passing.

Orion transport and the HTTPS image responses are deterministic test fixtures;
the render, DOM, mutation observation, image decoding, font loading and painting
are real. The first draft used an HTTP asset URL, which the existing asset policy
correctly rejected; the fixture was corrected to allowlisted HTTPS. Production
gates were not modified.

All six archived PNGs (three states × two dependency variants) have the same
SHA-256: `f6bce076905c4cafa41d51849a005e4dae9a42625c3c5e37f8420d09ffebb084`.

- [Fresh reference](served-host-candidate/fresh-final.png)
- [Patched candidate](served-host-candidate/patched-final.png)
- [After lease](served-host-candidate/after-lease.png)
- Registry-package equivalents: `served-host-registry/`.

The candidate PNG was visually inspected: the orange image, white disc and
French text are present. Pixel equality is exact for this fixture, not a renewed
Wellplayed/template-stats Figma proof or a physical CEF/GPU/broadcast proof.

## Cross-repository scope

Orion's typed compiler preserves serialized render output and independent default
ownership, and all Go packages/vet pass. Prism's snapshot/diff changes preserve
patches and pass its full 3,561-test suite plus typecheck/lint/build; its local
sidecar was rebuilt from the modified Orion source. Each repository has its own
plan, benchmark and validation report. No end-to-end timing is inferred by adding
the separate CPU measurements. Orion's optional race-detector run remains
unavailable locally because CGO and a C toolchain are absent.
