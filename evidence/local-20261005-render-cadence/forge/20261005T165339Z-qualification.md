# Qualification locale du rendu LSDP / Vision

Verdict **PASS**. Scène réelle complète, caméra physique, serveur LSDP natif et Pulsar CEF. Le candidat Vision est local et intégré au package Solar. Aucun commit, push, merge ni modification Prism.

512 transactions distinctes sont cadencées sur 2500 ms (charge imposée : 204,8/s). Chacune est reçue séquentiellement et vérifiée dans Solar, dans l’ordre, sans resynchronisation. Les valeurs scalaires peuvent partager une image ; 361 états distincts terminent une présentation sur la passe entière.

| Fenêtre fixe depuis le début | ACK natifs | Mutations LSML reçues | États distincts terminés côté Solar/Vision |
|---|---:|---:|---:|
| 0–1000 ms | 205 | 204 | 137 |
| 1000–2000 ms | 205 | 204 | 144 |

Dans les premiers 100 ms : **20 ACK natifs, 18 mutations LSML reçues, 9 états distincts terminés**. La cadence n’est pas uniforme à chaque intervalle de 100 ms ; le critère 120/s est appliqué à chaque fenêtre complète fixe de 1000 ms.

Le fichier exporté contient **1,000 s, 60 images et 60 valeurs différentes**, toutes lisibles, strictement croissantes et identiques aux 60 images consécutives originales. Fenêtre choisie avant la capture : 1–2 s. Aucun compteur ajouté, aucune interpolation. Le compteur est le champ texte de la scène. Chaque image du fichier exporté a été relue indépendamment par OCR.

![Extrait réel CEF : 60 images et 60 valeurs](D:\Documents\Zab\Artifacts\2026-10-05\lsdp-512-verified\20261005T165024Z-disjoint-final-paced-512-lsdp-cef-1s-60fps.mp4)

[Enregistrement complet](D:\Documents\Zab\Artifacts\2026-10-05\lsdp-512-verified\20261005T165024Z-disjoint-final-paced-512-lsdp-cef.mp4). Le dernier état 512 apparaît vers 2520 ms, avec une incertitude d’alignement de ±26,2 ms. Les surfaces grises restent présentes sur toutes les images ; la caméra est conservée. Le LSML et le LSMLZ sources restent inchangés et les mutations RAM sont abandonnées après le test.

Le coût médian des appels moteur est de 2,3 ms pour l’application Vision et 1,6 ms pour l’encodage/soumission du rendu. La latence médiane du dernier état envoyé au reçu de présentation couvrant vaut 17,72 ms. Ce ne sont ni des traces internes d’application du serveur natif, ni une mesure du scanout physique.

Vision effectue 3 à 7 contributions de composition par image mesurée, au lieu de retomber à 177 lorsque caméra et texte changent ensemble. 75 images utilisent deux zones distinctes ; les pixels situés entre ces zones restent conservés. 40 comparaisons GPU exactes avec le nouveau cache désactivé dans l’oracle couvrent le résultat et l’invalidation.

| Critère | Risque | Commande / preuve |
|---|---|---|
| 512 mutations reçues, ordre et hashes | perte ou confusion de reçus | Reproduction native/CEF ; runtime PASS, 512/512 et zéro resync |
| Au moins 120 états rendus/s | compter caméra, LSML ou acquittements fusionnés comme images | analyse-render-cadence.py : 137 puis 144 dans les fenêtres fixes |
| Contenu vidéo à 60 fps | répétition, texte illisible, surfaces absentes | analyse-native-counter.py puis verify-counter-clip.py : 60 valeurs/60 images, zéro trou |
| Pixels du compositeur | changement de blend, clip, bord ou déplacement | GPU requis : 40 sorties exactes comparées au compositeur sans nouveau cache |
| Commandes et cycle de vie | barrières ou médias périmés | Solar : 192 tests / 26 fichiers ; lint, types, build et 35/35 modules accessibles |
| Source Vision et package | WASM périmé, provenance ambiguë | pins source/binaire comparés avec le build Vision et les deux copies Solar |
| Préservation | modification Prism ou source persistée | baselines Git identiques ; LSML/LSMLZ identiques ; processus propres récolés |

Vision : **144 tests Rust**, **13 tests JavaScript**, fmt/clippy et WASM release réussis. Deux tests opt-in de polices externes sont ignorés comme précédemment ; la vraie scène et ses polices sont cependant exercées par CEF. Les contrôles de build/pins/binaire natif réussissent.

[Rapport JSON et hashes](D:\Documents\Zab\Solar\.worktrees\forge-local-20261003-source-resolution\evidence\local-20261005-render-cadence\forge\20261005T165339Z-qualification.json). [Preuves propres à Vision](D:\Documents\Lumencast\lumencast-vision\.worktrees\eleven-local-20261004-solar-surface-parity\evidence\local-20261005-render-cadence\eleven\20261005T165339Z-qualification.json).

La preuve concerne cette scène, ce matériel et ce profil. Le débit natif interne n’est pas déduit de la cadence imposée. La rafale immédiate historique de 512 transactions n’est pas requalifiée ici ; elle avait saturé l’abonnement natif. Les limites de mémoire et les chemins complets du compositeur sont conservés. La documentation de reproduction et des frontières se trouve dans [render-cadence.md](D:\Documents\Zab\Solar\.worktrees\forge-local-20261003-source-resolution\docs\development\render-cadence.md).
