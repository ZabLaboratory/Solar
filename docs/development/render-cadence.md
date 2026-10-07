# Native mutation render cadence

Solar measures three separate boundaries: the native server's authoritative
transaction ACK, sequential hash-verified LSML reception in the worker, and a
covering presentation after an actual Vision submission and front-canvas copy.
The encoded Pulsar CEF video is checked independently. Neither a native ACK nor
a browser RAF heartbeat counts as a new rendered mutation state.

## Scheduling and retained rendering

`src/engine/frame-patches.ts` preserves every transaction identity while merging
scalar values through a microtask. `src/engine/vision-frames.ts` owns one actual
submission in flight, scheduled by MessageChannel rather than a 60 Hz RAF.
Camera-only work waits at most 8.33 ms for state to join; a state patch or lifecycle
barrier bypasses that grace. `vision-media-bridge.ts` uploads the latest owned
camera image before the same state submission. Errors reject the covered callers;
scene transitions and ordered commands drain pending presentation first.

Vision retains glyph tessellation (1024 entries, 8 MiB), byte-identical shader
uniforms per live pass occurrence, and raw pre-effect composition. Up to eight
disjoint old/new damage regions replay the original blend operations in their
original order. Overlapping regions merge transitively. A camera and a distant
score do not force replay of the space between them. Raw/prefix textures share
a 64 MiB budget. Topology, output-size and authoring-size changes invalidate the
cache; large damage, backdrop effects, non-normal blends and single-sample direct
paint keep the full path. The native GPU oracle compares 40 incremental outputs
with a fresh compositor whose new composition cache is disabled.

The exact local engine bytes and source provenance are recorded in
`public/vision/vision-assets.json`. The qualified source is commit `f86fa436d3065402d23bbf06de8e309e8e954ea3`, merged
in Vision PR #1 as `4feaca8822400de4a201a8768334578918d9d949`. The manifest
resolves the source diff relative to that immutable repository tree; the completed
Vision worktree has been removed. The preserved archive is recorded beside it.
The WASM/glue bytes in Solar remain identical to the CEF-qualified candidate;
checks compare their hashes with the emitted host. The native LSDP source and binary stay unchanged.

## Proof contract

`native-burst-producer.mjs` prepares 512 different native transactions with unique
identities, preconditions and expected intermediate hashes. Paced mode uses
producer-anchored deadlines. It records actual send and ACK times; preparing or
queuing 512 transactions is separate from their sequential application.

`analyse-render-cadence.py` counts native ACKs, sequential LSML receipts, actual
Vision patch submissions and distinct completed covering frames in fixed 100 ms
and 1000 ms windows starting at the producer's epoch. Camera-only frames do not
count. Every complete 1000 ms window must contain at least 120 completed mutation
states. This boundary is GPU submission plus the complete front-canvas copy,
not physical monitor scanout or an internal native-core apply-time trace.

`analyse-native-counter.py` decodes the actual 1920x1080, 60 fps CEF recording. The
scene's `texte bloc` is the counter rendered by Vision; the diagnostic HUD does
not replace it. Every frame checks the unchanged gray surface interiors against
the complete reference scene, with a codec tolerance. The clock in the recorded
CEF HUD establishes the producer-relative alignment and reports its uncertainty.
The one-second export uses 60 consecutive source frames from the **predeclared
1–2 second window**, without interpolation or counter replacement. Startup and
the first 100 ms remain measured in the complete report.

`verify-counter-clip.py` then independently OCRs all 60 frames of the exported
file, without reusing a previous reading. It requires 60 readable, strictly
increasing values matching the original consecutive frames, an exact one-second
duration and 60/1 frame rate. The aggregate verdict must require both the fixed
cadence and the encoded-pixel criteria; passing either alone is insufficient.

The real scene, assets, physical camera, native receiver and Pulsar CEF process
are used. All intermediate hashes and receipt order must match, with no resync.
The source LSML/LSMLZ hashes must remain unchanged; the mutated document is
ephemeral RAM state and is discarded when the owned host stops. Only the proof's
own processes are reaped. No broadcast or Prism edit is part of this proof.

## Reproduction

From the Solar continuation worktree, with the real immutable source and the
local CEF-enabled Pulsar executable available:

```powershell
$env:PULSAR_BROWSER_GPU = '1'
$env:SOLAR_PROOF_CEF_FPS = '120'
$env:SOLAR_PROOF_CAPTURE_FPS = '60'
$env:SOLAR_BURST_MODE = 'paced'
$env:SOLAR_PACED_DURATION_MS = '2500'
$prefix = Join-Path (Get-Location).Path ('evidence/local-20261005-render-cadence/forge/' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-proof')
python evidence/local-20261005-burst-consolidation/forge/20261005T133902Z-reproduce.py --solar (Get-Location).Path --source '<absolute immutable scene.lsml>' --pulsar '<absolute cef-enabled pulsar.exe>' --output $prefix
python scripts/proof/analyse-render-cadence.py --prefix $prefix
python scripts/proof/analyse-native-counter.py --prefix $prefix --final-deadline-ms 2800 --video-window-offset-ms 1000 --minimum-distinct-values 60
python scripts/proof/verify-counter-clip.py --prefix $prefix
```

CEF source cadence and recording cadence are separate. The host must request
120 Hz for the browser source; the stream/recording can remain 60 fps. The observed
backend here is WebGL/ANGLE, not an available WebGPU adapter. A controlled input
rate (512 / 2.5 s) is a load profile, not the native server's throughput ceiling.
Scalar state updates can share one rendered frame: all transactions are applied
and covered, while the video samples only the states actually visible at 60 fps.

The historical immediate 512-transaction burst saturated the native subscription
and needed resync before these rendering optimizations. That uncontrolled burst
has not been requalified by this paced test. The native binary has no internal
apply-time traces, so ACK transport timing must not be labelled native-core
mutation execution time. Installed-application orchestration remains a Prism
integration responsibility; this work does not modify Prism.
