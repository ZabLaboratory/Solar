# Vision image measurement assets in Solar

- Solar worktree: `D:\Documents\Zab\Solar\.worktrees\eleven-local-20261018-vision-image-assets`
- Base Solar revision: `ca6af362544e26e9e940dac4ff37204d5a555405`
- Included Solar liveness revision: `7992ec825329f2f1eea7dc545d889662efde549f`
- Source Vision revision: `dc68104a2009495fbd2370305acf0b2e48d56d18` (signed)
- Source Vision proof: `evidence/local-20261018-image-intrinsic-measure/eleven/20261018T100318Z-agent-report.md` in Lumencast/lumencast-vision.

The previous Vision WASM rejected an image node whenever the layout requested intrinsic measurement. The new Vision source measures from admitted image bytes and keeps the encoded aspect ratio when one axis is known. Solar now pins the generated JS and WASM from that source revision.

| Asset | SHA-256 | Bytes |
| --- | --- | ---: |
| `public/vision/pkg/lumencast_vision_web.js` | `a363caf50f9faecf5cf3a3527c0fed18501ffe9d92ddd3b96d445fe3d2e3f8d4` | 157228 |
| `public/vision/pkg/lumencast_vision_web_bg.wasm` | `7902241abdba4a4697f445cf26435142aee0c234395327b088e54472df89a77b` | 10624299 |

Validation in this Solar worktree: `node scripts/check-vision-assets.mjs`, `npm run build`, `npm run check:architecture`, `npm run typecheck`, `npm test -- tests/unit/vision-session.test.ts` (23 passed), and `git diff --check` all passed. The build verified a single copy of each Vision asset in the host distribution.

Vision's focused intrinsic-image, linked-source/live-lane, and rollback tests passed; `cargo check` for wasm32 and the canonical `scripts/vision/build-web.ps1` passed. The full Vision library test run was interrupted during the 512-PNG dynamic lifetime case and is not claimed as passed. Physical Prism cockpit opening is a separate acceptance check.
