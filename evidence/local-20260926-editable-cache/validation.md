# Solar editable-preview cache — local validation

## Result

Generic target caching is implemented for the accepted-patch convergence window.
The existing 1,250 ms lease and per-frame reapplication remain intact. Element
selections are invalidated for element insertion/removal/reordering and binding
attribute changes, including pending mutations in the same JavaScript task.
Text-only changes do not invalidate element selectors. The observer and cached
references are released after the last lease expires and on teardown. Hosts
without MutationObserver keep the previous uncached behavior.

No scene names, component IDs or product-specific exceptions occur in the code.
The canonical checkout was preserved; changes live on `codex/solar-editable-cache`
in the worktree named in [manifest.md](manifest.md). No commit, push, merge,
package release or runner deployment was performed in this increment.

## Validation observed

| Command                                                                                       | Result                                                           |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `npm ci`                                                                                      | Successful clean install in the new worktree; lockfile unchanged |
| `npm run lint`                                                                                | Passed                                                           |
| `npm run typecheck`                                                                           | Passed                                                           |
| `npm test`                                                                                    | 32 files, 201 tests passed, including 7 new sideband cases       |
| `npm run build`                                                                               | Library and served host built                                    |
| `npm run check:bundle`                                                                        | Size budgets and zero-bare-specifier check passed                |
| `SOLAR_E2E_BROWSER=system-chrome npm run test:e2e`                                            | 3 served-host E2E tests passed                                   |
| `node scripts/bench-editable-preview.mjs --baseline d8d28f723168d0949a990e8d00b779335f99aa4c` | 6 DOM/PNG comparisons passed; system Chrome selected             |

The tests cover runtime overwrites, cached descendant replacement (text, image,
SVG and sizing), missing/replaced wrappers, duplicate ordering, binding changes,
text-only changes, newer accepted values, expiry/new leases, teardown/late
messages, and the uncached fallback.

## CPU benchmark

Seven samples per scenario, one discarded warm-up per variant, alternating
baseline/candidate order. Values below are median CPU milliseconds for initial
accepted-patch handling plus 75 controlled RAF callbacks. Images are decoded
before the run. Real Chromium DOM and MutationObserver execute the actual
baseline and candidate sideband sources, with synthetic WebSocket events.

| Wrappers | Active patches | Structure                                 | Before (ms) | After (ms) | Reduction |
| -------- | -------------- | ----------------------------------------- | ----------: | ---------: | --------: |
| 100      | 4              | Stable                                    |         5.1 |        1.1 |     78.4% |
| 500      | 4              | Stable                                    |        20.8 |        1.2 |     94.2% |
| 1,000    | 1              | Stable                                    |        10.8 |        0.8 |     92.6% |
| 1,000    | 4              | Stable                                    |        43.9 |        1.3 |     97.0% |
| 1,000    | 8              | Stable, includes image/text patches       |        91.4 |        3.5 |     96.2% |
| 1,000    | 4              | Replace a patched wrapper every 15 frames |        39.7 |        2.6 |     93.5% |

For four stable patches, binding scans drop from 304 to 1 (initial application
plus 75 frames). With four wrapper replacements they drop from 304 to 5. With
eight stable patches they drop from 608 to 1. The benchmark asserts these counts
and that accepted opacity is restored after it is overwritten on every frame.

The cold index has a cost: for 1,000 wrappers and one patch, median initial
application was 0.4 ms before and 0.7 ms after. The full convergence workload
still dropped from 10.8 ms to 0.8 ms. Very small timings approach the browser's
timer resolution; query counts and output equality provide deterministic checks.

All six baseline/candidate DOM serializations match, and all six PNG pairs are
byte-identical. The screenshot with 1,000 wrappers and eight patches was also
visually inspected: text, inline SVG and decoded images are present. Raw samples,
browser version, source hashes and PNG hashes are in
[chromium/report.json](chromium/report.json); both PNG variants are adjacent.

## Scope of the proof

These measurements cover the editable-preview convergence loop on a synthetic
DOM. They do not measure GPU composition, OBS/CEF, the full live
Prism–Orion–Pulsar path, or the Wellplayed/template-stats Figma proof. The three
existing E2E cases validate the served host bundle, not an authenticated live
editing session.

No dependencies were changed. The clean install reported five audit findings
(three moderate, two high) in the existing dependency graph; dependency updates
were outside this implementation.

Rollback is the removal of the target-cache argument and lifecycle integration;
the previous one-shot DOM patch functions remain available without a cache.
