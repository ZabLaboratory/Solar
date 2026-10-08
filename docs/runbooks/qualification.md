# Qualifier Solar, Orion et CEF

Propriétaire : Solar pour rendu/paquet/récepteur, Orion pour exécution/publication
native, ZabCanvas pour admission/signature/source. Chaque preuve reste dans son dépôt.
Les worktrees actifs et les sessions applicatives restent préservés. Ne jamais
écrire le document live muté dans la source originale.

## Candidat stable

Arrêter uniquement les processus possédés avant de reconstruire dist. Construire
le binaire natif release depuis la révision exacte, avec le target-dir sous Solar ;
le checkout Lumencast reste en lecture seule. Le paquet installé n'a besoin ni de
Cargo ni de checkout Lumencast. Le manifeste vérifie le SHA256 du binaire.

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run check:architecture
npm.cmd run check:native-client
npm.cmd test
npm.cmd run build
npm.cmd run package:native -- --binary <lsdpd.exe> --platform win32-x64 --revision <sha-source>
npm.cmd run check:native-package
npm.cmd run check:bundle
node scripts/test-reception-recovery.mjs <original.lsmlz>
node scripts/test-reception-server.mjs <original.lsmlz> <worktree-Orion>
node scripts/test-reception-install.mjs <original.lsmlz> <worktree-Prism-lecture-seule> <worktree-Orion>
```

Le dernier test charge l'adaptateur existant Prism en mémoire avec un résolveur de
racine installé, reçoit un LSML complet et une opération, contrôle Preview/client
TCP Orion puis récolte le processus. Il qualifie dist et cet adaptateur ;
le cycle complet de l'application Prism installée reste distinct.

Pour qualifier le tarball npm, installer dans un dossier neuf sous Solar/build
avec la politique npm allowScripts locale autorisant le postinstall Solar.
Les scripts de patch doivent être présents dans le tarball et retrouver les
dépendances hoistées via import.meta.resolve. Vérifier les exports navigateur/server
et tous les hashes dist contre le candidat ; ne pas modifier la politique npm globale.

Dans Orion, utiliser le toolchain déclaré, exécuter go test -race -json ./... avec
un compilateur C local, go vet, staticcheck et go build. Les opt-in natifs sont
exécutés séparément par le test de réception. Dans Canvas : uv run ruff check .,
uv run mypy src et uv run pytest ; garder les skips externes visibles.

## Admission réelle et reprise froide

Depuis ZabCanvas, le script suivant travaille dans une base locale isolée.
Il lit la vraie scène et l'identité à travers ZabGate, valide la Blue publiée,
projette les sept assets de l'archive complète et appelle la validation Vision.
Il publie/projette/valide/signe uniquement la copie locale. Les credentials restent
en RAM ; la clé de signature locale privée n'est pas exportée.

```powershell
uv run --project <worktree-ZabCanvas> python <worktree-ZabCanvas>/scripts/prove-vision-source.py --session <session-Prism-lecture-seule> --credentials <credentials-test> --scene <scene-id> --archive <original.lsmlz> --output <worktree-ZabCanvas>/evidence/local-20261005-final-certification/forge/<UTC>-actual-vision
```

Le rapport nomme producerArtifacts. Il contient scene.lsml, scene.lsmlz et
capsule.json (programme/manifeste/signature + trust public). Le driver Solar
consomme cette capsule, sans verdict semé ni clé créée par le host. Regénérer la
capsule juste avant la preuve ; conserver les durées réelles de cinq minutes
pour les refs et une minute pour la readiness.

```powershell
build/proof-python/Scripts/python.exe scripts/prove-cold-start-cef.py --pulsar <pulsar.exe> --orion <worktree-Orion> --source <producerArtifacts/scene.lsml> --capsule <producerArtifacts/capsule.json> --output evidence/local-20261005-final-certification/forge/<UTC>-canvas-cold
```

Le driver vérifie deux phases, des processus neufs, Program et Preview en CEF,
les surfaces/images/textes et la caméra, les capsules/déclarations/sélection
inchangées et l'abandon des mutations RAM. Les commandes sont découvertes depuis
le programme reçu ; aucune liste LEC/LCK particulière n'est un oracle.
Hors ligne, les requêtes DB échouent explicitement et leurs erreurs sont vérifiées.
Sans --capsule, le driver utilise des signatures/manifeste de contrat de test :
ne pas présenter ce mode comme une admission réelle Canvas.

Le cache disque est vérifié entre processus ; cette preuve n'est pas une preuve
de persistance IndexedDB ni d'autorité Blue indéfinie après expiration.

## Caméra peer et scène complète

```powershell
build/proof-python/Scripts/python.exe scripts/prove-peer-camera-cef.py --pulsar <pulsar.exe> --orion <worktree-Orion> --meet <checkout-Meet-lecture-seule> --source <original.lsml> --output evidence/local-20261005-final-certification/forge/<UTC>-final-peer-camera
```

Le harnais lance le vrai serveur Meet, un publisher caméra dans un Pulsar séparé
et deux Solar CEF. Il vérifie RTP décodé, absence d'émission vidéo des viewers,
arrivée/départ/retour, réaffectation Program et libération Preview ; dix images
1920×1080 conservent les surfaces et assets complets. Les affectations de cette
preuve passent par les mutations natives du harnais ; les contrats Orion assign/
release ont leurs tests séparés. Tous les processus possédés sont récolés.
Cette preuve est locale : aucune qualification WAN/TURN n'est implicite.

## Frontière déployée et consolidation

scripts/prove-authenticated-canvas.mjs sépare identité/JWS réelles, route source
et locator broker-only. Un opérateur refusé sur ce locator n'est pas une preuve
d'absence d'artefacts. Le flux mTLS/delegation est à exercer par l'intégration Prism.
Le Canvas déployé doit recevoir les nouvelles routes avant la preuve distante.

Le générateur du certificat antérieur est conservé avec ses
[preuves historiques](../../evidence/local-20261005-solar-audit/forge/20261005T183100Z-historical-certify-chain.py).
Il réconciliait les hashes et baselines propres à cette phase. Il n'est plus une
commande de qualification courante et ne doit pas régénérer la documentation actuelle.
Voir
[la maturité et le certificat](../development/maturity.md) pour résultats,
frontières et branchements restants dans Prism.
