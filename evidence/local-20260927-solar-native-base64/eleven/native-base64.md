# Solar native base64 fast path

Date: 2026-09-27
Work unit: `local-20260927-solar-native-base64`
Scope: shared Solar render-asset wire; no scene- or customer-specific behavior.

## Measured signal

The earlier integrated Chrome CPU capture attributed 12.984 ms of self-time to
the existing `bytesToBase64` implementation and 2.247 ms to native `btoa` for
100 distinct images. That capture is diagnostic, not a stable latency target.

A paired microbenchmark ran on Headless Chrome 153.0.8010.53 with 100
deterministic `Uint8Array` payloads of 3,036–3,044 bytes. Each sample encoded
the full set 30 times; nine alternating samples were collected after warmup.
The existing chunked `String.fromCharCode` + `btoa` path had a median of
242.0 ms; `Uint8Array.toBase64()` had a median of 1.7 ms. The encoded strings
matched for every payload. This is a microbenchmark result, not an end-to-end
readiness claim.

The implementation uses the native method only when the running browser
provides it. The existing chunked encoder remains unchanged as the fallback
for older browser/CEF runtimes.

## Integrated regression proof

The actual Prism → local Orion → built Solar Chrome pipeline passed with the
new Solar bundle and the same Orion binary (`5c1cbd987e3dadb9166ff2e11e302a0385beca02b94c90ba516babeeeb711de0`)
as the pre-change comparison. All ten PNGs matched byte-for-byte against the
prior candidate run; the 25- and 100-image fresh/patched/converged hashes also
matched. The browser was Chrome 153.0.8010.53, the error list was empty, and
the test-owned Orion process stopped.

- Pre-change comparison: `D:\Documents\Zab\Prism\.worktrees\local-20260927-prism-inline-image-cost\evidence\local-20260926-preview-pipeline\eleven\20260927T041142Z-run`
- Post-change run: `D:\Documents\Zab\Prism\.worktrees\local-20260927-prism-inline-image-cost\evidence\local-20260927-solar-native-base64-premerge\eleven\20260927T050453Z-run`
- Post-change CPU profile: `D:\Documents\Zab\Prism\.worktrees\local-20260927-prism-inline-image-cost\evidence\local-20260927-solar-native-base64-profile\eleven\20260927T050655Z-run\solar-renderer.cpuprofile`

The integrated fixture hydrated 100 unique sources with one batch request. Its
30-image customer fixture retained the existing three individual requests.
The post-change CPU profile's high-self-time entries contained no named
`btoa`/base64 function; the minified bundle limits function-level attribution.
The before/after Chrome profiles are single diagnostic captures and are not
used to claim a stable full-scene latency improvement.

## Validation

- `npm test -- tests/unit/render-asset-wire.test.ts`: 12 tests passed.
- `npm test -- --no-file-parallelism`: 32 files, 209 tests passed.
- `npm run lint`, `npm run typecheck`, `npm run build`, and
  `npm run check:bundle` passed.
- Prettier check and `git diff --check` passed.
- Integrated Prism → Orion → Solar preview pipeline passed twice, including
  the CPU-profiled run; all ten output PNGs matched the pre-change run.

## Risk and rollback

The only behavior change is choosing a native byte-to-base64 encoder where it
exists; the fallback preserves the prior implementation on older runtimes.
Rollback is limited to removing that feature-detected fast path and its test.
No deployment, on-air action, Pulsar change, or cache/protocol change was made.
