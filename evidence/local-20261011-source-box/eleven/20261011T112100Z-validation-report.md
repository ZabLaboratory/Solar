# Strict image source boxes

Branch eleven/local-20261011-source-box; base f627cf6504a787170b2b3c5d812afeb5b3401c61.
Only generated Vision WASM and its artifact/provenance pins change. Generated
JavaScript glue is byte-identical. Signed Vision source is
b9af5e5eb375d790e4c165006c715b069c112a38, based on merged e5b2720589e30820bd6b70b89cc78fec0ab6153a.
The image `clipEffects` contract remains LSML; no alternate JSON dialogue is added.

Validation: 35 Vitest files/261 tests; build library, host and server; artifact
pins, runtime layout, self-contained host bundle, code map and native package
checks all passed. Native receiver revision e695e14f9f664f430ffc2e0e75d083fab88abc7f
and binary SHA256 7bd059c56b0daa56b3da24f0ccdb3b6a888709feff9618cd3b8cd2a045bdce60
are unchanged.

Local package v3.0.0-local-5dee95338d606eca is installed in the common Prism dev.
All four served asset hashes match pins. New WASM SHA256:
b16e4c250c1ec0f321042a7258dcb7ee4a2ecc4d5a818244b5377edfc5f34db3.
Keep this worktree while .cache/prism-package is the shared launch source.
New correction is local; no merge claimed. Prism retains the aggregate dev proof.
