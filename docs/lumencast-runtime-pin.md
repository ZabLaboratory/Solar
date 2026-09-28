# Temporary Lumencast runtime pin

The signed `v0.18.3` tag did not publish to npm because its GitHub Actions
`NPM_TOKEN` cannot publish `@lumencast/canonical`. Lumencast PR #135 is merged
as commit `6e04ec7cb205559045bc75737ca5a7ad0c7e6a11`, tree
`7e1dd919bc32bcac3e2073b22168f3cc66b428a3`. Its workspace package version
is `0.18.4`, which is **not published**. Do not tag a release until npm access is
repaired.

For now Solar's Vite library and browser host import the generated runtime
chunks in `vendor/lumencast-runtime/`. They were built with `npx vite build` in
`packages/runtime/` from a worktree whose tree matched that merged commit.
The upstream Apache-2.0 license accompanies the vendored files.
`manifest.json` pins every generated JS chunk and source map by SHA-256. The
host-bundle gate verifies this inventory and the `supportsHostAssetUrls`
capability; an installed npm `0.18.2` entry cannot silently replace it. The
installed package still supplies TypeScript declarations and Solar's existing
postinstall compatibility patches.

To reproduce, check out that exact Lumencast commit in an isolated worktree,
install its locked dependencies, run the runtime Vite build, and compare the
seven JS chunks and seven source maps with `manifest.json`. To remove the pin
after the matching version is published, update Solar's dependency and lockfile,
restore both Vite aliases to the installed runtime entry, remove this vendor
directory, and rerun Solar's build/bundle/typecheck/tests plus Prism's integrated
PNG E2E before merge. No Pulsar code is changed by this pin.
