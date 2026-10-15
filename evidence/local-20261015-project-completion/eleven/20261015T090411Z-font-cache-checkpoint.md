# Installation font cache: demonstrated recovery defects

Owner: Main 1 / Eleven. Worktree: D:/Documents/Zab/Solar/.worktrees/eleven-local-20261015-project-integration. Branch: eleven/local-20261015-project-integration. Source HEAD before this proof: 2f666dc35df6d18bc6ff701e2661d2d624967f7c.

Three real-class reproductions use the current installation-fonts.ts transpiled in memory with the existing TypeScript dependency. Tiny fixtures and results live only in the explicit C: thread temporary directory recorded in the JSON. No production source, package, native process, real installed font or shared runtime was changed. The reproduction font bytes are deliberately simple content-addressing fixtures; these tests do not exercise typography parsing or rendering.

1. A truncated index.json makes prepare reject with SyntaxError instead of rebuilding the cache from a readable source font.
2. A valid JSON object with sources:{} makes prepare reject with TypeError: previous.map is not a function.
3. A cached font overwritten with different bytes of the same length is considered reused (reused=1, filesRead=0). A new service prepare keeps the corrupt bytes; its authenticated GET returns 500. Thus a restart does not repair this cache corruption while source metadata remains unchanged.

Relevant source: installation-fonts.ts prepare at lines45-56, warm reuse at85-95 and endpoint integrity at181-182. native-server.ts launch awaits fonts.prepare at197 before spawning the native receiver at202, so cases1/2 prevent that launch path. This is source/reproduction evidence, not a full Electron launch or real-font test.

Next correction: treat absent/invalid cache metadata as a rebuildable cache miss, validate schema and each source record, and retain propagation of genuine filesystem failures. Recover corrupted content-addressed copies from unchanged verified source bytes when corruption is detected; do not trust equal length and do not rehash every valid installation font on every warm startup. Preserve endpoint token/origin/digest validation and transactional publication. Cover truncated/wrong-shape/invalid-row metadata, clean warm reuse, same-length corruption recovery and unrecoverable I/O.

Implementation is still pending. D: fell below40MiB free during this audit; no new worktree/dependency install/build was started. The observed Windows pagefile reserves42121MiB on D:, with6166MiB currently used (a snapshot, not proof of the complete free-space-loss chronology). No pagefile setting or foreign process/file was modified. The only D: output here is this small diagnostic proof. Goal remains active; transitions and switch duration remain excluded.
