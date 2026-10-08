# Solar

Solar is the LSDP scene client and Vision renderer for Zab broadcast hosts.
The native LSDP resource supplies the authoritative scene id, `scene_version` and live leaf state;
Solar fetches that exact published LSMLZ revision from ZabCanvas and mounts it
in Vision. Scene changes use the next authoritative LSDP snapshot. Solar does
not request or render compiled scene bundles.

Once a mutation arrives over LSDP, Solar verifies and applies it, then Vision
renders it. This mutation contract is independent of its producer: no Orion
query, producer acknowledgement or `x-orion` projection is required. Solar's
reception and presentation events identify the native transaction and state;
they do not carry producer projections. Scene-selection coordination is a
separate contract.

Vision owns LSML/LSMLZ parsing, retained scene state, assets and GPU rendering.
Solar owns the LSDP connection, pinned source acquisition, local capture and
receive-only peer streams, and camera texture updates. Blue declaration and
validation pins arrive with the ZabCanvas source manifest; Blue execution stays
on its validated server path and its LSML mutations arrive through LSDP.

## Public API

```ts
import { createCanvasSceneSourceProvider, mount } from "@zablab/solar";

const handle = mount({
  target: document.getElementById("scene")!,
  nativeLSDP: { url: "ws://127.0.0.1:4007/lsdp", resource: "solar/program" },
  token: showToken,
  mode: "broadcast",
  sceneSourceProvider: createCanvasSceneSourceProvider({
    apiUrl: "https://zabgate.cyell.dev/canvas/api/v1",
    token: canvasToken,
  }),
});

handle.setToken(rotatedShowToken);
handle.disconnect();
```

The source provider requests by scene id, pins every fetch to the LSDP
`scene_version`, verifies response identity and hashes, and carries the
revision's Blue manifest beside the LSMLZ bytes. `createCachedSceneSourceProvider`
and `FileSceneSourceStore` now preserve verified immutable sources/assets/Blue
closure through that same boundary when supplied by the application host.
The standalone Solar host acquires the selected scene directly and performs no
catalog synchronization or inactive-scene preloading. Launcher synchronization
and account-scoped local source storage remain an integration task.
See [source cache](docs/development/source-cache.md).

Native Lumencast LSDP supplies the complete live LSML document. The mount
requires `nativeLSDP: { url, resource, selector? }`; the standalone host accepts
`/host.html?lsdp=<encoded-ws-url>&resource=scene`. `selector` pins one entry in
`solar/generations` or `solar/sessions`; unrelated entries never retarget the
renderer. Solar uses the byte-pinned Lumencast browser client and
`LSDP-TCP/2.0-draft2`; it reads a fragmented resource snapshot, subscribes at its
Merkle hash, and applies atomic `lsdp.apply/1` notifications. See
[native local development](docs/development/native-lsdp.md) for the Rust server
launcher and mutation endpoint.

The `@zablab/solar/server` entry runs in a Node 22+/Electron-main host. It owns
the packaged Rust receiver, injects declared Solar/Orion resources and waits for
real protocol readiness. The browser entry never creates a process. Full LSML
is delivered to the existing native `state` route, where Rust computes the diff;
explicit operations use atomic application transactions. The application host owns one shared instance and supplies TCP to Orion and
WebSocket to Solar; wiring the installed Prism lifecycle remains its integration task.

## Host configuration

The served host gets its scene identity only from LSDP. A trusted embedding host
sets `globalThis.__SOLAR_CONFIG__ = { nativeLSDP, canvasApiUrl, canvasToken }` before
loading Solar. The default Canvas API is ZabGate's `/canvas/api/v1`; if no
Canvas-specific token is configured, Solar reuses the show token. Every mode
uses the same Vision scene path. Test sessions subscribe to `solar/sessions`
with the actual Orion API session ID as selector; closing that entry clears
the renderer. Program and Preview use separate role-stable resources.

Vision's presenter module and WASM engine are served from `public/vision/` and
copied into `dist/host/vision/` only by the host build. The library build disables
Vite's public-directory copy. `npm run check:layout` rejects duplicate Vision
assets, missing or changed copies, and every collision when the host is promoted
to the installed runtime root. It runs at build completion, in `check:bundle`,
before npm packing and immediately before release archive creation.
The four engine/host files are SHA-256 pinned in public/vision/vision-assets.json.
Regenerate those checked-in
assets from the configured `lumencast-vision` source after changing its Rust or
presenter code, then run `npm run check:bundle`.

## Development and checks

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm run check:architecture
npm test
npm run build
npm run check:bundle
```

`npm run build` emits the public ESM API and a self-contained host page for
Orion static serving and Pulsar CEF. The peer-viewer compatibility dependency
is bundled from its WebRTC-only entry; its compiled-bundle renderer is not used.

Unit checks cover native snapshots/mutations, exact scene revision acquisition,
Vision activation, Blue manifest identity and camera/peer texture updates.
They do not prove authenticated production access, physical camera behavior,
Pulsar composition or deployment. Cache storage and exact offline reads are
available through exported adapters with bounded storage; startup synchronization
is not wired into the standalone host.
Prism integration remains outside this scope.

- [Qualification native, CEF et paquet installé](docs/runbooks/qualification.md)
- [Maturité locale et preuves](docs/development/maturity.md)

- [Architecture and current code index](docs/development/architecture.md)
- [Code, symbols and consumers](docs/development/code-map.md)
- [Maintenance and qualification tools](scripts/README.md)

`npm run code:map` refreshes the derived index; `npm run code:check` rejects drift.
`npm run code:read -- <path-or-symbol>` and `npm run code:find -- <query>` inspect
the current source graph. `npm run check:architecture` also verifies active local
documentation and named commands. Historical ADRs and evidence describe their own
candidate, not the current runtime.
