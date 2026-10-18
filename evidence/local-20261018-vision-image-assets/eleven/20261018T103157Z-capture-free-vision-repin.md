# Vision capture-free contribution repin for Solar

Solar source branch: `eleven/local-20261018-vision-image-assets`.
Vision runtime commit: `f28cda9665babd49408873fc7659947441f293dd` (signed; tree `7f90855124302fa574ee1e8dacf244cde1f41c65`).
Vision evidence: `evidence/local-20261018-empty-capture-contribution/eleven/20261018T103049Z-render-report.json` in Lumencast/lumencast-vision, evidence commit `bd8036c475ba5ddc9c2177d5574beae2e836169b`.

Pinned generated files:
- `public/vision/pkg/lumencast_vision_web.js`: SHA-256 `4bf4f676c667dc484e77bbe941945d76d24401393fcb1e4a9e73d346ecdc7e64` (157228 bytes).
- `public/vision/pkg/lumencast_vision_web_bg.wasm`: SHA-256 `7690e6ba4e56220a375d76a9b19750af987e352ac6c35508e8d2ff65957e32b8` (10627091 bytes).

Validation in Vision: 10/10 contribution pixel tests on RTX 3070/Vulkan, including nested frame clip plus effect and root mask/clip/effect/opacity parity; build-web, targeted rustfmt and diff check passed. Validation in Solar: `node scripts/check-vision-assets.mjs`, `npm run build`, `npm run typecheck`, `npm run check:architecture`, and 66/66 focused Vision unit tests passed. Physical Prism cockpit opening remains a separate qualification and is not claimed by these tests.
