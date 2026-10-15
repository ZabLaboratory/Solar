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
