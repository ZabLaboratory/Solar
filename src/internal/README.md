# Native state integrity

Owner: Solar protocol integrity. `native-state.ts` applies immutable atomic operations;
`native-tree.ts` computes the normative draft2 Merkle digest with bounded depth/nodes.
`native-stream.ts` classifies ordered notifications and pins before/after hashes.
`native-digest.ts` supplies the worker-local frame checksum without modifying global crypto.
`validate-options.ts` checks the public mount boundary before connecting.

`NativeTreeHasher` also memoizes exact serialized immutable subtrees resent by
absolute coordinator assignments. Its LRU holds at most 128 entries and 4 MiB of
serialized UTF-16 keys; keys larger than 512 KiB are excluded. These are text-key
budgets, not a claim about total retained JavaScript heap. Cached normative digests
include node/depth counts, and portable JSON validation, whole-resource limits and
before/after integrity checks remain mandatory. Copied-root, eviction and edited
leaf tests compare with an independent uncached normative hash.
Path copies with an existing verified origin bypass serialized-content lookup:
their changed branches use the incremental digest, without stringifying the
complete LSML root or its unchanged subtrees.
The worker keeps the same bounded hasher across same-connection snapshot catch-up;
`NativeState.from` validates each new snapshot before reusing its immutable digests.

Consumers: the browser worker/client/runtime and the Node reception watcher. This domain
owns no rendering, capture, source cache or process launch. The byte-pinned upstream
client and vectors remain in `vendor/lsdp-native-browser/`; its own license/pin checks
apply separately. Local helpers cannot retain otherwise unused modules through tests.

Checks: native-state, native-stream, native-digest, native-worker-client and mount suites;
`npm run check:native-client`, `npm run check:source-usage`, `npm run typecheck`.
