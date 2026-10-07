# Receive-only peer cameras

Owner: Solar source adapters. Entry: `src/sources/peers.ts`, consumed by the
Vision live-media controller. This domain creates no camera publisher.

`injection.ts` normalizes the host or reserved native viewer/slot declarations,
checks room addresses and reconciles the existing compatibility channel.
`antenne-controller.ts` arms the receive-only viewer when room credentials
arrive and reconciles native slot snapshots. `slot-binding.ts` resolves an
authored slot to a peer stream and forwards roster/stream changes to its listeners.

Named slot assignments override roster order. Untouched positional `@<n>` keys
retain the existing arrival-order contract. An explicit release keeps a null
tombstone for that registry's lifetime: a later peer arrival cannot refill it.
A new scene/controller has its own assignments. Source identity and room
credentials stay in native authority; `__cam.*` leaves are removed only from
the temporary Vision render package.

Tests: `slot-binding.test.ts`, `antenne-controller.test.ts`,
and `scripts/prove-peer-camera-cef.py`. The latter uses actual Meet/WebRTC,
a physical camera publisher in a separate Pulsar process, two receive-only CEF
viewers and complete-scene captures. It qualifies local WebRTC; WAN/TURN is a
separate deployment proof.
