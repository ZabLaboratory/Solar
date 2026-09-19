# Editable Preview feature map

`src/internal/editable-preview-fast-path.ts` is the stable import facade. The public `mount()` API is unchanged.

| Feature | File under `src/internal/editable-preview/` |
| --- | --- |
| Patch types, decoding and value validation | `patch.ts` |
| LSDP snapshot/delta sequencing gate | `delta-gate.ts` |
| Applying accepted values to rendered DOM | `dom.ts` |
| Local sideband URL, accepted messages, reconnect and bounded convergence | `sideband.ts` |
| Preview WebSocket adapter | `websocket.ts` |

Dependencies flow from transport to gate/parser and DOM application. Timings, accepted properties, sequence rules and teardown remain the existing implementation. The existing fast-path test suite imports the facade to retain compatibility coverage.
