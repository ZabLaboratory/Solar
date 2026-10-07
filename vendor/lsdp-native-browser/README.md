# Native LSDP browser transport

Unmodified portable client files and conformance vectors from
`Lumencast/lumencast-lsdp-native`, revision
`e695e14f9f664f430ffc2e0e75d083fab88abc7f` (0.0.0-draft.2).
Apache-2.0; LICENSE is included. The adjacent declaration is Solar-owned.

This local vendor boundary avoids a machine-specific npm file dependency on the
private upstream package. It includes neither a JS server nor the Node addon.
Solar connects to the real Rust lsdpd process using LSDP-TCP/2.0-draft2 over
WebSocket. Refresh the three portable files together and run the Rust interop
test after an upstream protocol update. `scripts/check-native-client.mjs`
verifies pinned bytes. The browser Merkle hash implementation in Solar follows
upstream spec/02-data.md and is checked against these upstream vectors and Rust.
