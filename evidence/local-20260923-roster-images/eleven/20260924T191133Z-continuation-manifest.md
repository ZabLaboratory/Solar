# Solar / Lumencast runtime optimization — continuation

Mandate: continue the Blue-scene runtime optimization directly, without agents.
Repositories/worktrees: `D:/Documents/Lumencast/.worktrees/lumencast-runtime-static-mount-20260923` (`codex/runtime-static-mount`) and `D:/Documents/Zab/Solar/.worktrees/eleven-local-20260923-roster-images` (`codex/local-20260923-roster-images`). Preserve their existing uncommitted candidate changes and all other worktrees.

Authorized in this continuation: local code, tests, package-install diagnosis/repair in the Solar worktree, locally served Program/CEF measurements with representative images, evidence. No production activation, secret mutation, deployment, merge, or package publication is presumed from the short "go". Reassess that boundary after local gates are proved.

| Criterion | Risk | Command/proof target |
| --- | --- | --- |
| Clean Solar install | Postinstall patches the wrong runtime layout or misses a bundled variant | `npm ci --offline`; inspect published package and patch effects |
| Candidate compatibility | Solar tests against a published package lacking the new option | Overlay only the built local candidate in disposable `node_modules`, then full Solar tests/build |
| Remote images in CEF | Data URLs prove rendering but not network decode placement | Use real HTTPS image URLs and explicit roster lead time; compare opt-in vs baseline, record CEF output and measurable requests/timing where possible |
| Production recommendation | Generation lane roster may arrive too late to warm images | Inspect actual Prism/Orion Program ordering; retain opt-in unless remote-image CEF and lead-time evidence justify it |

Initial observation: `npm ci --offline` reproduces the peer-stream-registry matcher failure at line 117 of Solar's postinstall script against published `@lumencast/runtime@0.18.2`. Its readable source has an inline `// idempotent re-emit guard` comment and its bundled symbol is `a`, not the script's hard-coded `c`.

Outcome: HTTPS-image Pulsar CEF cold/warm proofs and the generation-wire timing series are in `20260924T192219Z-cef-remote-and-release-gate.md`. A temporary postinstall matcher repair reached a second incompatible WebRTC contract and was reverted. Exact candidate overlay builds and renders but fails 7 Solar WebRTC tests, so publication/activation is held. A temporary upstream WebRTC port was also reverted after 18 Lumencast test failures; the original candidate again passes 998 tests. No branch/remote/production mutation was made.
