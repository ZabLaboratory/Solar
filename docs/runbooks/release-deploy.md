# Solar release and deployment contract

Owner: Solar packaging; Orion and the application own installation/activation. Source of
truth: `.github/workflows/release.yml`, `package.json`, `scripts/check-runtime-layout.mjs`,
`scripts/create-runtime-manifest.mjs` and `scripts/check-native-package.mjs`.
This runbook describes the current candidate. It does not claim a release was published,
a runner provisioned, Linux qualified or the installed Prism application migrated.

## Build and qualify

The workflow triggers on `v*.*.*` tags and uses the configured `[self-hosted, vps-ovh]` runner
with Node 22. It performs npm installation, lint, type checks, architecture checks, native
client pins, tests, build and bundle checks. The package version must match the tag.

```powershell
npm.cmd ci
npm.cmd run check:architecture
npm.cmd run test:architecture
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run check:bundle
```

Postinstall patches only the receive-only WebRTC modules needed by Solar; its scripts and
helpers must ship in the npm tarball. Dependency resolution supports hoisted installations.
Unit checks do not replace the [native/installed/CEF qualification](qualification.md).

`npm run build` clears dist. Package unchanged native binaries **after** building:

```powershell
npm.cmd run package:native -- --binary <lsdpd.exe> --platform win32-x64 --revision <native-sha>
npm.cmd run package:native -- --binary <lsdpd> --platform linux-x64 --revision <same-native-sha>
npm.cmd run check:native-package -- win32-x64 linux-x64
```

The release workflow takes `SOLAR_LSDP_WINDOWS_BINARY` and `SOLAR_LSDP_LINUX_BINARY` runner
variables. Missing files fail assembly. The manifest pins platform binary digests and source
revision; the installed application requires no Cargo, source checkout or esbuild.

## Artifacts and layout

- npm package: ESM/browser API `dist/solar.js`, declarations, workers, Node server entry,
  host/Vision assets and the required postinstall files. `prepack` checks the combined layout.
- release: `solar-<tag>.tgz`, flat `dist/` contents, plus `solar-runtime-manifest.json`.
  Both Windows/Linux native binaries are mandatory for this release manifest.
- standalone browser page: `host/index.html`; assets resolve relative to the page.
  An installed host may promote the host directory into its runtime root only after the
  collision/digest check. Flat dist packaging does not itself perform that promotion.
- server: `server/index.mjs`, declarations, `native/manifest.json` and platform binaries.

The runtime layout guard rejects missing or duplicated Vision assets, changed bytes and
collisions between host promotion and library/server files. Its tests cover adversarial
layouts. The release runs this guard immediately before archive creation.

The archive name, flat dist layout, manifest schema and Orion static version route are
integration contracts. Changing them requires corresponding consumer work. The archive
contains application JavaScript and a native receiver; it is not a compiled scene bundle.

## Publish, install and activate

For an explicitly authorized release: update package/lock version, qualify the exact
candidate, commit with the configured signature, and create a **signed** `vX.Y.Z` tag.
Push the tag only when publication is authorized. The workflow publishes the release assets.
Verify the release archive/manifest hashes separately from CI completion.

Orion's deployment or the installed application then downloads and verifies the selected
release, installs it into its versioned runtime directory and activates that exact version.
The configured static route is `/static/solar/<tag>/host/index.html` for the flat archive;
a host-promoted installation serves its own root page. Confirm the consumer's actual layout
and URL before use. Supply the local native WebSocket/resource (and exact selector for
collections), plus the trusted Canvas config; old `?orion=...&scene=...` URLs are obsolete.

The Node/Electron application owns the shared reception host, readiness, TCP/WS distribution,
recovery, credentials, logout and shutdown. Completing this Solar package does not wire the
installed Prism application's lifecycle. Deployment/activation and a real cold-start/CEF
smoke test are separate completion states.

## Rollback

Keep the previous verified runtime installed. Stop the owned receiver and switch the browser,
server and package to the same previous version; restart from admitted immutable source and
selection. Do not carry incompatible RAM mutations or mix native manifests across versions.
A signed source revert follows a reviewed PR. Deleting a release tag does not roll back an
already installed runtime, and a successful download does not prove activation.
