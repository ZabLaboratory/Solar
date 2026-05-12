# Solar — vanilla embed example

A minimal page that loads `@zablab/solar` via `<script>` tag and runs
the `Score Update` animation on click.

## Run it

From the repo root :

```bash
npm run build                 # produces dist/solar.umd.js
python -m http.server 5173 \
  --directory examples/embed-vanilla
# open http://localhost:5173/
```

(any static server works ; the file paths above use a local relative
import of `../../dist/solar.umd.js` so it works offline too)

## What it shows

- Loading Solar as a plain UMD script alongside `react` /
  `react-dom` UMD builds.
- Authoring the scene in JSON (no JS execution surface).
- Driving a numeric `count-up` action via `playAnimation()` with
  `${param.*}` interpolation.
- Subscribing to `animation:completed` to log when playback is done.

See `../../docs/embed-on-website.md` for the full integration guide.
