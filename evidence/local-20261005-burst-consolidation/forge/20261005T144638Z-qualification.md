# Compteur LSDP natif — preuve CEF réelle

Verdict : compte et ancrage vérifiés pour le flux cadencé ; **fluidité de 60 nouveaux états par seconde non certifiée**. La rafale immédiate n'est pas qualifiée pour la livraison exhaustive des états intermédiaires.

Le grand compteur est la feuille LSML `/defaults/__lit.text.text_msxz43eh_1`, rendue par Vision. Les diagnostics DOM ne dessinent pas ce compteur. Pulsar enregistre sa vraie source CEF à 1920×1080 avec la caméra physique et tous les assets/surfaces de la scène. Les 60 images de l'extrait proviennent de 60 images consécutives de l'enregistrement ; aucun nombre/image interpolé.

| Mesure | Cadencé sur 850 ms | Rafale immédiate |
|---|---:|---:|
| Transactions et opérations produites | 512 / 512 | 512 / 512 |
| Acquittements natifs appliqués | 512 | 512 |
| Dernier acquittement natif | 868.8 ms | 506.8 ms |
| Mutations reçues/appliquées dans Solar | 512 | 108 puis snapshot de resynchronisation |
| Soumissions Vision couvrant ces mutations | 23 | 8 |
| Valeurs du compteur réellement visibles dans 1 s | 23 | 7 |
| Dernier compteur dans l'extrait de 1 s | 512 | 247 |
| Première apparition de 512 dans l'enregistrement | 979.8 ms | 1312.3 ms |
| Incertitude d'alignement des pixels | ±34.2 ms | ±25.2 ms |
| Frames avec surfaces grises manquantes | 0 | 0 |

Dans les 100 premières ms du test cadencé : 60 ACK natifs, 27 événements LSML Solar, 8 reçus couverts par 3 soumissions Vision. Les six images encodées montrent 0, 1, 8, 8, 8, 27. Ces frontières sont distinctes. Le binaire natif n'expose pas le temps interne pur d'application : le débit des ACK n'est pas présenté comme ce temps interne.

Le flux cadencé possède les 512 identités dans l'ordre ; les 512 hashes intermédiaires correspondent au producteur et le dernier hash de la frame couvrante correspond au hash natif final. Aucun resync ni erreur de rendu. Le tampon `broadcast::channel(64)` et la file de transport de 16 événements expliquent le `SUBSCRIBER_LAGGED` observé en rafale immédiate ; Solar récupère le dernier état mais ne fabrique aucune preuve des événements intermédiaires absents. Lumencast est resté inchangé.

La copie du canvas complet vers CEF coûte 0.2 ms en médiane (3.7 ms maximum). Elle corrige les surfaces partiellement échantillonnées ; les mesures ne permettent pas de la désigner comme principal coût de la cadence.

LSML/LSMLZ d'origine inchangés, mutation uniquement en RAM puis restauration, caméra conservée, même PID natif, Prism inchangé, processus de preuve récolés. Les validations locales couvrent 185 tests sur 24 fichiers, types/lint/build/bundle, 33 modules accessibles et les pins natif/Vision. Le hook global du workspace a expiré après 300 s ; aucun succès global n'est revendiqué.

- [Extrait cadencé : 1 s, 60 images](D:\Documents\Zab\Artifacts\2026-10-05\lsdp-512-verified\20261005T144202Z-paced-512-lsdp-cef-1s-60fps.mp4)
- [Enregistrement cadencé complet](D:\Documents\Zab\Artifacts\2026-10-05\lsdp-512-verified\20261005T144202Z-paced-512-lsdp-cef.mp4)
- [Rafale immédiate complète, échec conservé](D:\Documents\Zab\Artifacts\2026-10-05\lsdp-512-verified\20261005T143355Z-burst-512-lsdp-cef.mp4)
- [Rapport détaillé cadencé](D:\Documents\Zab\Solar\.worktrees\forge-local-20261003-source-resolution\evidence\local-20261005-burst-consolidation\forge\20261005T144202Z-report.json)
- [Rapport détaillé immédiat](D:\Documents\Zab\Solar\.worktrees\forge-local-20261003-source-resolution\evidence\local-20261005-burst-consolidation\forge\20261005T143355Z-report.json)

Reproduction depuis le worktree Solar :

```powershell
$env:SOLAR_BURST_MODE='paced' # 'burst' pour la rafale immédiate
$env:SOLAR_PACED_DURATION_MS='850'
python evidence/local-20261005-burst-consolidation/forge/20261005T133902Z-reproduce.py --solar 'D:\Documents\Zab\Solar\.worktrees\forge-local-20261003-source-resolution' --source 'C:/Users/Mathias/AppData/Local/Temp/codex-zab/solar-vision-localproof/scene.lsml' --pulsar 'D:/Documents/Zab/Pulsar/upstream/build_x64/rundir/RelWithDebInfo/cef-local-proof/bin/64bit/pulsar.exe' --output '<préfixe UTC canonique dans evidence/.../forge>'
python scripts/proof/analyse-native-counter.py --prefix '<même préfixe>'
```
