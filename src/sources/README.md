# Live source resolution

Solar owns local capture resolution and receive-only peer sessions independently
of Vision's scene graph. `LiveMediaController` consumes Vision's live-source
descriptors and uploads each resolved video frame into the corresponding Vision
texture.

| Capability | Entry point | Contract |
| --- | --- | --- |
| Local camera, screen, window and app capture | `capture.ts` / `createCaptureResolver` | Maps the scene's logical `deviceRef` to a host-provided device or desktop-capture id. Missing or inaccessible sources remain transparent. |
| Receive-only remote cameras | `peers.ts` / `createPeerSources` | Reconciles room membership, joins as viewer, resolves the reserved `__cam.slots.*` leaves and publishes `MediaStream` changes by slot. |
| Vision texture updates | `engine/live-media.ts` | Fits camera frames to the exact Vision texture size, uploads them, and clears textures on disconnect or source replacement. |

Capture is not limited by Solar mode. The host must pass stable machine-local
capture mappings; Solar never opens a native picker or selects an arbitrary
default camera. Remote audio remains muted except when the host enables
`liveAudio` for broadcast or test.

The only compatibility dependency on `@lumencast/runtime` is its receive-only
WebRTC viewer. Vite resolves it through `dist/webrtc/index.js`, so its compiled
scene renderer is excluded from both Solar outputs. `sources/` does not own LSML
assets: Vision reads the assets packaged in the exact LSMLZ source.

## Checks

- `capture-resolution.test.ts`: logical capture references, cameras in every
  Solar mode, screens, windows, apps, missing mappings and default screens.
- `peer-viewer-injection.test.ts`, `antenne-controller.test.ts` and
  `slot-binding.test.ts`: room configuration, slot reconciliation, subscriptions
  and teardown.
- `live-media.test.ts`: local and remote stream frames reach Vision textures;
  source replacement clears textures and releases subscriptions/capture tracks.
