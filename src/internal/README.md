# Native state integrity

Owner: Solar protocol integrity. `native-state.ts` applies immutable atomic operations;
`native-tree.ts` computes the normative draft2 Merkle digest with bounded depth/nodes.
`native-stream.ts` classifies ordered notifications and pins before/after hashes.
`native-digest.ts` supplies the worker-local frame checksum without modifying global crypto.
`validate-options.ts` checks the public mount boundary before connecting.

Consumers: the browser worker/client/runtime and the Node reception watcher. This domain
owns no rendering, capture, source cache or process launch. The byte-pinned upstream
client and vectors remain in `vendor/lsdp-native-browser/`; its own license/pin checks
apply separately. Local helpers cannot retain otherwise unused modules through tests.

Checks: native-state, native-stream, native-digest, native-worker-client and mount suites;
`npm run check:native-client`, `npm run check:source-usage`, `npm run typecheck`.
