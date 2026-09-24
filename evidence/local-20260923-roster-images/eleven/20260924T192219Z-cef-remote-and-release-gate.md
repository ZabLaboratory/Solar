# Blue image predecode in Pulsar CEF — local follow-up (2026-09-24)

## Candidate and method

- Solar built host `dist/host/index.html`: SHA-256 `298c8caa7668e39accef3680f48329a8f6b0c48041d9b8a9d9f6eeb62e044c1c`.
- Lumencast candidate entry `dist/lumencast.js`: SHA-256 `b80560682911fb1fadd3761281e3ae19967deafc0f5a1383cee05509c5e61dde`.
- Fixture: Orion's `canvas-chat-sponso.scene-bundle.json`, 342 nodes and 30 image elements. Its three original Figma image URLs are expired. The probe derives a content-addressed bundle with three real HTTPS Data Dragon images (a host already allowed by the fixture). A unique URL query per Pulsar process defeats the browser image cache. These are representative bytes, not the Figma original.
- `probe-served-host.mjs` launches the Pulsar CEF browser_source, serves the built Solar host, speaks a local LSDP/1.1 wire, observes resource completions and detached `Image.decode()` calls in the served page, captures the OBS source at 1920x1080, then terminates the probe process. No live Program or remote Orion service was modified.

## Persistent show wire: early roster, later scene switch

Commands: `node evidence/local-20260923-roster-images/eleven/probe-served-host.mjs --cef-remote=cold` and `--cef-remote=warm`.

| Variant | HTTPS image resources before switch | After switch | Detached decodes before switch | Images ready after switch (one run) |
| --- | ---: | ---: | ---: | ---: |
| Flag off | 0 | 3 | 0 | 250 ms |
| Flag on | 3 | 0 | 3 | 179 ms |

Both rendered 30/30 images; both Blue captures have SHA-256 `403ca8a7137e1c39e2592d75a5b7047b70771dd0b70e6e7cec478db40c0277a9`. This establishes the network/decode work moved before the switch when the roster truly leads it. The timings are single-run observations, not a stable latency estimate. See `cef-remote-{cold,warm}-results.json` and matching PNGs.

After adding fail-closed invariants to the probe, a repeat cold run passed with
178 ms and the same screenshot hash. Its result file replaces the initial
250 ms JSON; the table records the original paired observation. In particular,
the paired 250→179 ms difference must not be generalized as a stable speedup.

## Immutable generation wire: initial Blue snapshot, then its roster

Code inspection: Prism's `resolveGenerationReturnUrl` uses `generation.lsdp` for a physical lane. Orion's `startBridge` emits a one-entry roster immediately before the initial snapshot/activation, and the wire replays the snapshot before the roster to a later subscriber. The local CEF harness emulates this subscriber-visible order with a single Blue generation; it is **not** a complete Prism→Orion physical Take.

Commands: `node evidence/local-20260923-roster-images/eleven/probe-served-host.mjs --cef-generation=cold` and `--cef-generation=warm`; 5 runs per variant, with the later 8 runs interleaved. Every run fetched 3 HTTPS resources, decoded 30/30 DOM images, and produced the same Blue screenshot SHA-256 as above. The option caused 3 detached decodes versus 0 without it.

| Variant | Subscribe → all images ready, ms (5 runs) | Median |
| --- | --- | ---: |
| Flag off | 570, 571, 390, 362, 372 | 390 |
| Flag on | 350, 414, 379, 371, 675 | 379 |

The ranges overlap, including a warm outlier slower than every cold run. No reliable latency gain is demonstrated for the physical generation ordering. Do not enable `preload_roster_images` on Prism's generation lanes from this evidence. The off-air browser's ordinary initial image fetch can still finish before Take; that readiness is a separate Prism/Pulsar gate.

The invariant-checked probe was rerun once after the series: warm 585 ms,
again 3 successful detached decodes, 30/30 images and the same screenshot hash.
That latest run replaces `cef-generation-warm-results.json`; the table above
records the original five-sample series.

## Release gate correction

- `npm ci --offline` fails in Solar's existing `postinstall` on the published `@lumencast/runtime@0.18.2` peer-stream registry matcher. An exploratory matcher adjustment passed that point but then failed on a different WebRTC handoff matcher; other patch sections can log success without changing the published readable module. The exploratory script edit was reverted. **Clean installation remains red.**
- For the CEF probes, `npm ci --offline --ignore-scripts` was followed by a disposable node_modules copy of Solar main's already-patched Lumencast dependencies, then the candidate Lumencast `dist` overlay; Solar was rebuilt. This is not a release installation.
- Against that exact overlaid candidate, Solar `npm test` failed 7 WebRTC identity/race tests (185 passed / 192 total), although Solar typecheck, lint, build and bundle-size checks passed. Those tests import the concrete runtime `dist/webrtc` modules; the candidate lacks the current Solar-specific postinstall WebRTC fixes. Earlier 192/192 evidence used patched dependency modules and must **not** be interpreted as candidate-package compatibility. The served Blue scene does not exercise WebRTC.
- A direct upstream port of the patched WebRTC source passed TypeScript but failed 18 legacy Lumencast tests because its async signaling and stream handoff require a deliberate contract/test migration. That exploratory port was reverted. Current Lumencast candidate is back to its original scope and passes 998 tests (2 skipped) plus typecheck.

Decision: retain the generic image-predecode feature as an **opt-in local candidate**. Do not publish/merge/activate it as a Solar release until the WebRTC patch debt is migrated or otherwise packaged reproducibly, the exact packaged candidate passes both suites, and the actual prepare-to-Take path is validated. No production or CI claim is made.
