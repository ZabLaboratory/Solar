# Solar editable-preview target cache

- Mandate: continue runtime optimization; the user explicitly authorized Eleven
  to implement directly without Forge. No delegated agents.
- Repository: `ZabLaboratory/Solar`.
- Worktree: `D:/Documents/Zab/Solar/.worktrees/solar-editable-cache`.
- Branch: `codex/solar-editable-cache`.
- Base: `d8d28f723168d0949a990e8d00b779335f99aa4c`.
- Scope: editable-preview DOM target resolution, convergence lifecycle, nearby
  tests and a reproducible Chromium benchmark. Public mount/protocol contracts,
  lease duration and rendering operations are unchanged.
- Authority: local implementation and validation. No runner deployment in this
  increment; no remote write performed.

| Criterion                         | Risk                                                    | Validation                                                               | Evidence                                            |
| --------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------- |
| Reuse stable element selections   | Repeated whole-document scans                           | Sideband query-count tests and Chromium benchmark                        | `editable-preview-sideband.test.ts`, benchmark JSON |
| Follow structural/binding changes | Applying patches to stale or wrong nodes                | Missing/replaced/reordered/renamed target and descendant tests           | Sideband unit tests                                 |
| Keep convergence and cleanup      | Stale runtime writes, retained observers, late messages | Reassertion, expiry, new lease and teardown tests                        | Sideband unit tests                                 |
| Preserve render output            | Visible regression                                      | Baseline/candidate DOM and exact PNG comparisons with decoded images/SVG | Benchmark artifacts                                 |
| Preserve existing behavior        | Broader runtime regression                              | Typecheck, lint, unit suite, build, bundle gates, E2E                    | Validation report                                   |

Benchmark command (uses an installed system Chrome when selected):

```powershell
$env:SOLAR_E2E_BROWSER='system-chrome'
node scripts/bench-editable-preview.mjs --baseline d8d28f723168d0949a990e8d00b779335f99aa4c
```

The benchmark loads the actual sideband source at the baseline revision and in
the working tree. It measures synthetic DOM CPU work under a controlled RAF and
socket, with real Chromium DOM and MutationObserver. It does not measure a full
Prism/Orion/Pulsar session, compositor cost or scene-switch latency.
