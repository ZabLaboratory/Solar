# Checkpoint — Prism camera-routing readback

## État et propriété

- Dépôt : `D:\Documents\Zab\Solar`.
- Worktree : `D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-camera-routing-readback`.
- Branche : `eleven/local-20261015-camera-routing-readback`.
- Base : `46466d70479f6b3622af9efaf88bfdbda7e8e48a`.
- Commit de code signé : `1f6c9f2affb79a0017e6572eb74f8e941d6f29a7` (`Add Prism peer camera routing readback`). `git verify-commit HEAD` réussit.
- Cette unité modifie seulement les fichiers Solar listés dans ce commit. Aucun autre worktree, binaire actif, serveur partagé, transition ou route lane n’a été modifié.

## Comportement livré

Solar réutilise `readPeerViewerChannel()` et `readReservedPeerLeaves`, puis produit sur le même canal loopback Prism un état `peer_viewer_routing` lié au `routingRevision`. Pour chaque `slotRef`, `peerLabel` représente l’identité effectivement résolue et `available` indique si son `MediaStream` est disponible. L’identité et la disponibilité sont ainsi distinguées : une identité assignée peut être connue avant que son flux arrive. Le snapshot initial est envoyé après la réconciliation des rooms et des assignments, puis actualisé au changement de roster/flux.

La lecture est additive au protocole `solar.host.v2`, annoncée par la capacité `prism.camera.routing-readback.v1`. Elle ne transporte ni room ID, ni token, ni URL de signalisation. Les snapshots Prism plus anciens continuent à router les caméras sans readback. Une erreur de sérialisation ou d’envoi reste observatrice et ne change pas la livraison vidéo. Les bindings relâchés conservent leur tombstone explicite et ne retombent pas sur l’ordre d’arrivée.

Pour respecter la limite d’entrée Prism, Solar omet entièrement un snapshot de plus de 256 références ou de plus de 16 384 caractères ; aucun snapshot partiel n’est envoyé et le routage vidéo continue. La taille est bornée selon la même longueur de chaîne que le consommateur Prism.

## Fichiers concernés

- `src/sources/peers.ts` : collecte et émission de l’état d’observation, bornes, cycle de vie et compatibilité avec anciens snapshots.
- `src/peer-viewer/slot-binding.ts` : accès à l’identité effective séparé de la disponibilité du flux.
- `scripts/build-host-html.mjs` et `scripts/check-host-bundle.mjs` : annonce et vérification de la capacité hôte.
- `tests/unit/peer-viewer-routing.test.ts` et `tests/unit/slot-binding.test.ts` : readback, changements de roster, tombstone, absence de secrets, échec de canal, ancien snapshot et omission des payloads trop grands.
- `src/peer-viewer/README.md`, `src/sources/README.md`, `docs/development/code-map.md` : contrat, propriétaire, tests et découverte.

## Validation

- `npm test -- --maxWorkers=1` : 38 fichiers, 327 tests réussis en environ 77 s.
- `npm run typecheck` : réussi.
- `npm run lint` : réussi après resserrement du diff au contrôle de capacité.
- `npm run check:architecture` : réussi (source usage, code map, documentation et limites de taille).
- `npm run build` : réussi, y compris génération du host, bundle server et contrôle de layout.
- `npm run check:bundle` : réussi après ajout du contrôle du contrat ; trois chunks JavaScript autonomes, assets Vision et transport peer-camera vérifiés.
- `git diff --check` : réussi.
- `dist/host/solar-host-contract.json` généré pendant le build annonce `solar.host.v2` et `prism.camera.routing-readback.v1`. SHA-256 : `CFE5750BF133609F4AAE8B22A814149F88C4C638F73CF60B6F8E40E072EBEB35`.
- Une première exécution complète en concurrence avec typecheck/lint/architecture/bundle a produit des timeouts à 5 s dans `scene-library.test.ts` et deux cas de `native-state.test.ts`, ainsi qu’un échec de nettoyage temporaire `ENOTEMPTY`. La relance complète isolée avec un worker a réussi sans changer les oracles. Aucun processus de test n’est encore actif.

Les tests utilisent un WebSocket local simulé et des streams simulés. Aucun handshake Prism/CEF réel ni essai caméra natif n’a été mené dans cette unité ; le readback n’a donc pas été validé en runtime partagé. Le contrôle du contrat hôte et le build prouvent la capacité empaquetée, pas son admission dans le serveur actif. Le consommateur UI Prism reste dans son unité d’intégration.

## Décision sur les anciens worktrees Solar audités

Source d’inventaire : `D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-project-integration\evidence\local-20261015-solar-consolidation\eleven\20261015T102002Z-inventory.json` et ses snapshots ZIP ; cette unité les a lus sans écrire dans ces worktrees.

- Les changements runtime des worktrees historiques ne sont pas repris en bloc : leur besoin de readback est couvert par le présent portage plus récent, qui conserve les sémantiques actuelles de bindings et de tombstone.
- Les anciens pins d’assets Vision ne sont pas conservés ; le candidat actuel valide ses quatre pins d’artefacts au build.
- L’ancien renderer DOM editable/cache est obsolète et ne doit pas être réintroduit dans le host. Le contrôle bundle continue à rejeter ces sources renderer retirées.
- Les démos Kumiki, sound et zab-z-bug sont déjà intégrées dans le candidat root indiqué par le propriétaire ; elles ne sont pas reprises dans ce commit.
- La revue root des contrôles sponsor, player et storyboard conclut que le candidat plus récent couvre audio/autoplay et les proof receipts ; aucun manque supplémentaire n’est porté ici.
- Transitions et routes lane restent explicitement hors mandat.

## Limites et suite

Le snapshot est best-effort et événementiel, sans promesse de fréquence de rafraîchissement ni garantie d’une image affichable au-delà de `available` (qui ne décrit que la présence du stream). L’interface Prism doit nommer clairement `peerLabel` et disponibilité comme mesures distinctes et tolérer l’absence de readback avec un ancien serveur. Le commit est candidat à revue/intégration ; aucune DLL active n’a été remplacée et aucun runtime/dev partagé n’a été redémarré.
