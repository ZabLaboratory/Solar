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
| `qualify-font-coverage.mjs` | Read-only Windows/packaged-font and installation-cache inventory; uses production registry discovery and capacity diagnostics, verifies source/cache SHA-256, and keeps engine registration unverified |
| `qualify-font-registration.mjs` | Private Chrome and installed Vision WASM; production font batching, cold admission and a second pass in one empty engine, with actual registry counters and exact artifact hashes |
| `native-burst-analysis.mjs` | Correlate observed transaction identities/hashes, presentation batches, queue samples and producer rates while preserving unavailable values |
| `native-burst-analysis.test.mjs` | `node --test tests/proof/native-burst-analysis.test.mjs`; coverage for gaps, duplicates, hash drift, batching, unknown metrics and timing |
| `analyse-render-cadence.py` | `--prefix <prefix>`; fixed receipt/LSML/completed-frame windows |
| `analyse-native-counter.py` | `--prefix <prefix>`; recorded counter and complete static surfaces |
| `verify-counter-clip.py` | `--prefix <prefix>`; independent 60-frame OCR/duration/cadence check |

See [render cadence](../../docs/development/render-cadence.md) and
[qualification](../../docs/runbooks/qualification.md). All script paths are current;
source/media/evidence inputs identify a particular run. Hashes/identities, physical pixels,
native ACKs and completed presentation are measured separately.

Font inventory invocation (Node with TypeScript transformation support):

```powershell
node --experimental-transform-types scripts/proof/qualify-font-coverage.mjs `
  --installed-root <installed-Solar-package> `
  --cache-index <installation-font-cache>/index.json `
  --report evidence/<issue>/eleven/<UTC-stamp>-font-coverage.json
```

The inventory never prepares or changes fonts, the cache, the running application
or its engine. It records counts and hashes without source paths or catalogue
credentials. Exact source-path index coverage is distinct from verified indexed
cache content: a moved package can have identical cached font bytes. Neither
count proves active catalogue admission, parser compatibility, glyph coverage or
Vision registration. Bitmap FON/FNT exclusions and missing registered files are
counted explicitly. The report refuses to overwrite an existing output file.

`qualify-font-registration.mjs` takes the same three arguments plus
`--playwright-root <Prism-worktree>`. It uses an ephemeral authenticated loopback
catalogue of the indexed cache contents and Solar's existing
`installationFontBatches`. An isolated Chrome browser creates one empty Vision
engine from the specified installed package, admits every file, then admits the
same files again. Rust's actual counters must remain identical after the second
pass. Artifact hashes, index hash, batch counts and timings are retained; no
running application is attached and no source/cache file is changed. The registry
counts decoded font resources, not every individual face in a TTC collection.
This does not qualify glyph rendering or the shared application's active bank.

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
the inner limit of two. It then sends a duplicate-key update and separately
records the native receipt, surfaced Vision rejection, retained front-canvas
pixels, computed layer visibility, and page screenshot. It corrects the collection
in the private native receiver and waits for Solar's `connecting` → `live` snapshot
recovery; snapshots do not produce `solar:lsdp-applied` receipts. After that, a
distinct keyed collection reorder and a scalar text mutation must each produce a
real applied event and changed visible pixels. The fixture is
`tests/fixtures/repeat-runtime/prism-authoring.lsml`; authoring/export source
provenance is checked against the read-only Prism worktree. This qualifies one
Repeat graph, active-frame retention after a rejected replacement and a same-session
reconnect/recovery path, not all scope grammars or every malformed package. It does
not test scene selection, transitions, physical display scanout or CEF.

Example invocation from the Solar worktree:

```powershell
node scripts/proof/qualify-repeat-runtime.mjs `
  --prism-root D:\Documents\Zab\Prism\.worktrees\eleven-local-20261015-project-integration `
  --native-bin D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-project-integration\dist\native\win32-x64\lsdpd.exe `
  --out build\repeat-runtime\<UTC-stamp> `
  --stamp <UTC-stamp> `
  --evidence evidence\local-20261015-rejected-mutation-frame\eleven
```
