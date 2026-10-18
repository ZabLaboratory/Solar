# Receive-only peer cameras

Owner: Solar source adapters. Entry: `src/sources/peers.ts`, consumed by the
Vision live-media controller. This domain creates no camera publisher.

`injection.ts` normalizes the host or reserved native viewer/slot declarations,
projects the active document through `readReservedPeerLeaves`, checks room addresses and reconciles the existing compatibility channel.
`antenne-controller.ts` arms the receive-only viewer when room credentials
arrive and reconciles native slot snapshots. `slot-binding.ts` resolves an
authored slot to a peer stream and forwards roster/stream changes to its listeners.

When the Prism loopback peer-viewer channel supplies `routingRevision` and
`slotRefs`, Solar reports each declared slot's effective `peer_label` and stream
availability back on that same channel. The observation is revision-bound,
contains no room credentials, and is best-effort: channel or serialization
failures never change the receive path. Older Prism snapshots without these
fields keep the existing camera behavior and do not emit readback. Readback is
omitted (never truncated) above 256 slot refs or Prism's 16,384-character inbound
frame limit; camera routing still continues.

Named slot assignments override roster order. Untouched positional `@<n>` keys
retain the existing arrival-order contract. An explicit release keeps a null
tombstone for that registry's lifetime: a later peer arrival cannot refill it.
A new scene/controller has its own assignments. Source identity and room
credentials stay in native authority; `__cam.*` leaves are removed only from
the temporary Vision render package.

Tests: `slot-binding.test.ts`, `peer-viewer-routing.test.ts`,
`antenne-controller.test.ts`,
and `scripts/prove-peer-camera-cef.py`. The latter uses actual Meet/WebRTC,
a physical camera publisher in a separate Pulsar process, two receive-only CEF
viewers and complete-scene captures. It qualifies local WebRTC; WAN/TURN is a
separate deployment proof.
