# Kumiki motion study

Owner: Solar demonstration authoring, retained development fixture. Original
five-act choreography of the canonical three-band Kumiki mark, using the existing
composed motion engine. This is a design study, not a Blue execution or an editor.
Review its retention when the motion authoring examples become a shared catalogue.

`trace.py <canonical-mark.png> <fixture-directory>/vectors.json` extracts three
closed contours with 256 corresponding points and reports thresholded silhouette
IoU. It does not change the supplied PNG. `scene.mjs` authors the band rig, waves,
orbital stroke reveals, particle cubic routes, contact cascade and spring locking.
The 171 grid points share one drawing; 36 contacts share three phase rigs, and
18 satellite dots share six cubic-route rigs. These are authored compositions,
not a claim of eighteen independently simulated particles.
`generate.mjs <fixture-directory>` writes a pure-vector 1280×720 LSML/LSMLZ scene.
Morph correspondence is authored with fixed topology; this is not video inference.

The fixture is `fixtures/kumiki-motion`. Run the generator, `npm run build`, then
set `SPONSOR_MOTION_PORT=4600` and `SPONSOR_LSDP_BIN` to the verified local native
server. Serve with `node scripts/sponsor-motion/serve.mjs fixtures/kumiki-motion`.
Existing sponsor-motion capture/cadence scripts accept explicit evidence paths;
the same native player controls the show. Vision draws every animated pixel.
Only the settled silhouette is compared with the source: intermediate waves and
disassembly deliberately depart from the static brand mark.

The final lockup now animates the canonical wordmark `Kumiki` and the exact
two-line hero signature, `Many systems.` / `One motion.`. The mark travels left
and settles without changing its traced silhouette or crossing topology. Native
LSML text nodes reveal each line in sequence; the sound-design fixture cues the
name and both lines at those same playhead times. The preferred typeface is
Recursive, with Solar's packaged Figtree as the host-safe fallback.

`export.py <fixture-directory> <evidence-directory> <artifact-directory>
<capture-stamp> <storyboard-stamp>` exports the actual capture to a VFR MP4 with
ffmpeg, copies the source scene and selected native frames, and hashes delivery
files. It does not render an alternative animation or duplicate video frames.
