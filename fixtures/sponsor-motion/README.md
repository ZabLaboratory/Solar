# Sponsor motion inputs

The two PNGs were supplied by the user for this local rendering demonstration.
Their bytes are preserved. `scripts/sponsor-motion/generate.mjs` builds the 720×720
LSML document, its archive with embedded PNGs and the command catalogue from them.
The fixture is a development rendering probe owned by Solar, consumed by the local
native host and the capture script. It does not declare a published scene or a
validated Blue program. Revisit it when the shared animation catalogue contract changes.

`wave/` holds the generated alternative LSML/LSMLZ and command catalogue. The
archive embeds the same original PNGs and uses experimental `x-vision.wave*`
bindings on two whole images. Its generator and limits are documented in the script README.
