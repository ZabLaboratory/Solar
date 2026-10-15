# CEF proof helpers

Owner: Solar qualification. The parent drivers in `scripts/` own process lifetimes and output
prefixes; these files contain reusable capture/producer/analysis boundaries.

| File | Use |
|---|---|
| `pulsar_cef.py` | Imported process/IPC wrapper; reaps only its own Pulsar child |
| `cef-capabilities.py` | `python scripts/proof/cef-capabilities.py --pulsar <exe> --output <prefix>`; adapter diagnostic, not scene proof |
| `cold-start-host.mjs` | Cold-start driver's HTTP/native fixture or admitted-capsule host |
| `meet-peer.mjs` | Peer-camera driver's receive-only viewer and publisher signaling helper |
| `native-burst-producer.mjs` | Native producer with distinct transactions, expected hashes and paced/burst modes |
| `generate-native-burst-fixture.mjs` | Generate the single-bound-text LSML/LSMLZ browser fixture |
| `qualify-native-burst.mjs` | Private real-daemon Solar/Vision Chrome run; `--mode paced --duration 3900` or `--mode burst`, plus `--playwright-root` |
| `qualify-repeat-runtime.mjs` | Private one-scene Solar/Vision run; invokes Prism's real LSML importer/exporter read-only, then exercises nested collection updates through `native-lsdp-local.mjs` and records retained front-canvas pixels |
| `native-burst-analysis.mjs` | Correlate observed transaction identities/hashes, presentation batches, queue samples and producer rates while preserving unavailable values |
| `native-burst-analysis.test.mjs` | `node --test tests/proof/native-burst-analysis.test.mjs`; coverage for gaps, duplicates, hash drift, batching, unknown metrics and timing |
| `analyse-render-cadence.py` | `--prefix <prefix>`; fixed receipt/LSML/completed-frame windows |
| `analyse-native-counter.py` | `--prefix <prefix>`; recorded counter and complete static surfaces |
| `verify-counter-clip.py` | `--prefix <prefix>`; independent 60-frame OCR/duration/cadence check |

See [render cadence](../../docs/development/render-cadence.md) and
[qualification](../../docs/runbooks/qualification.md). All script paths are current;
source/media/evidence inputs identify a particular run. Hashes/identities, physical pixels,
native ACKs and completed presentation are measured separately.

The native burst qualification uses a private headless Chrome browser and the retained
Solar front canvas after a Vision `frame-submitted` response. Its report keeps native ACK,
Solar receive/applied identities, resync recovery, receive-to-presentation latency, queue
telemetry and final pixel OCR separate. A covering submission count is a logical mutation
coverage count, not an image/frame rate; retained-canvas polls and OCR attempts are counted
separately, while actual display-frame sampling remains unavailable. Error observations
include their capture phase so browser teardown can be distinguished from the measured
transaction window. The proof does not measure GPU completion, CEF, physical scanout,
scene switching or live audio/video capture.

The focused Repeat run takes an LSML authoring fixture through Prism's actual
import/export functions, checks that the team/player defaults and scoped text
bindings survive, and feeds the exported LSMLZ into a private RAM-only Rust LSDP
receiver. Solar's existing host then renders that one scene through its pinned
Vision WASM. The run captures the original two-team/two-player-per-team view,
one scalar text change, keyed team reorder, and scoped insertion/removal under
the inner limit of two. It then sends a duplicate-key update and records native
acceptance, Vision's rejection, the retained canvas buffer, computed layer
visibility, and the page screenshot separately. A cached canvas hash alone does
not prove the previous frame stayed visible. In the captured Solar build, the
duplicate-key payload receives a native `applied` receipt, Vision rejects a
recovery `load`, and a traced opacity write in
`src/engine/vision-presenter.ts` hides the retained canvas; this run is
explicitly partial and does not qualify malformed-update recovery or last-frame
retention. The driver does not test scene selection, transitions, physical
display scanout or CEF.

Example invocation from the Solar worktree:

```powershell
node scripts/proof/qualify-repeat-runtime.mjs `
  --prism-root D:\Documents\Zab\Prism\.worktrees\eleven-local-20261015-project-integration `
  --native-bin D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-project-integration\dist\native\win32-x64\lsdpd.exe `
  --out build\repeat-runtime\<UTC-stamp> `
  --stamp <UTC-stamp> `
  --evidence evidence\local-20261015-repeat-runtime-proof\eleven
```
