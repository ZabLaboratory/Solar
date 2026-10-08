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
| `analyse-render-cadence.py` | `--prefix <prefix>`; fixed receipt/LSML/completed-frame windows |
| `analyse-native-counter.py` | `--prefix <prefix>`; recorded counter and complete static surfaces |
| `verify-counter-clip.py` | `--prefix <prefix>`; independent 60-frame OCR/duration/cadence check |

See [render cadence](../../docs/development/render-cadence.md) and
[qualification](../../docs/runbooks/qualification.md). All script paths are current;
source/media/evidence inputs identify a particular run. Hashes/identities, physical pixels,
native ACKs and completed presentation are measured separately.
