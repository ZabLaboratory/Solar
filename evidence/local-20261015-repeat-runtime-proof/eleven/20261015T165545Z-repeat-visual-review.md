# Repeat runtime visual review

Run: `20261015T165545Z`

Report: `20261015T165545Z-repeat-report.json`

I visually read the saved page screenshots; no automated OCR engine was used.
The report's `brightBands` are measured from the 800×500 retained-canvas pixels
and provide the vertical positions for each rendered text row.

The initial capture shows `LIVE ROSTER`, then `RED TEAM` with `ALICE 11 R` and
`BOB 22 R`, then `BLUE TEAM` with `DANA 44 B` and `ELI 55 B`. The seven measured
canvas text bands are y=24–39, 69–82, 99–110, 131–142, 195–208, 225–236 and
257–268. The initial screenshot is
`20261015T165545Z-repeat-initial.png`.

The leaf update changes Alice's visible score from `11` to `19` in
`20261015T165545Z-repeat-scalar-update.png`. The keyed reorder puts Blue before
Red in `20261015T165545Z-repeat-team-reordered.png`. The bounded insertion shows
`IVY 99 B` and `DANA 44 B` under Blue while the second item limit clips Eli;
`20261015T165545Z-repeat-player-added.png` captures it. Removal restores
`DANA 44 B` and `ELI 55 B` in
`20261015T165545Z-repeat-player-removed.png`.

After the duplicate-key mutation, the page screenshot
`20261015T165545Z-repeat-duplicate-key-rejected.png` is exactly 1100×650 and all
715,000 RGB pixels are white. At the same time, the retained canvas hash still
matches the last valid frame and the scene layer's computed opacity is 0. The
source-mapped opacity write is recorded in the JSON report. This proves the
canvas buffer survived while its visible layer did not.
