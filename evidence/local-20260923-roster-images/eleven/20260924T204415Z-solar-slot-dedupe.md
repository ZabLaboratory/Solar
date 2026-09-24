# Solar reserved-leaf slot fan-out — local optimization (2026-09-24)

## Scope

The Lumencast reserved-leaf observer emits a complete `slots` projection when one `__cam.slots.*` value changes. Solar's `createAntenneController` applies every projected slot to `createSlotBindingRegistry.assign()`. Previously, even an unchanged binding tore down and recreated its peer subscription, re-emitting the same stream to every listener. The same registry also serves Prism's local viewer path.

`assign()` now returns when the normalized binding (`null` for empty/unbound) is unchanged. Changed bindings still re-key immediately; a peer registry track replacement still notifies listeners; releasing a binding still emits the placeholder. No public API, wire format, room reconciliation, or scene renderer changed.

## Validation

- Focused unit tests: 33/33 passed across `slot-binding` and `antenne-controller`, including direct and controller-level assertions that changing `cam-2` does not re-emit unchanged `cam-1`, while a new `cam-1` track still emits.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:bundle`, and `git diff --check`: passed.
- Solar full unit suite: 186 passed / 7 failed (193 total). The 7 failures are all in `meet-viewer-identity-race.test.ts`, matching the already-observed WebRTC candidate-package incompatibility; before the two new tests the same candidate had 185 passed / 7 failed (192 total).
- Served-host Playwright smoke with `SOLAR_E2E_BROWSER=system-chrome`: 3/3 passed. The default Playwright Chromium shell was not installed; the first run failed before test execution, then the repository's supported system-Chrome mode passed.
- Served host: 161,503 bytes gzip across JS chunks, under the 400 KiB budget; zero bare ESM specifiers.

This proves elimination of redundant subscription/notification work for unchanged slot bindings, not a measured end-to-end frame-time gain. The Blue image fixture has no Meet slot, so its visual and image-readiness results do not serve as a performance benchmark for this change. Do not publish this Solar candidate while the clean-install/postinstall and 7 WebRTC release gates remain red.
