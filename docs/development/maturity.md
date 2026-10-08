# Maturité locale — intégration fonctionnelle et cadence du rendu

ZabCanvas valide la scène et ses Blues. Orion charge les artefacts admis, exécute
les commandes/awaits/stream-rules et rapporte dispatch, effets et erreurs.
Solar acquiert le LSMLZ ou le LSML avec ses assets et présente Vision.
Orion ne compare aucun résultat métier attendu pour décider si une Blue est vraie.

Le prochain propriétaire de changements applicatifs est **Prism**.
Le verdict fonctionnel est **PASS_LOCAL_READY_FOR_PRISM_INTEGRATION**. Les adaptations
Solar, Orion et ZabCanvas de cette campagne restent locales, sans publication ni
déploiement. Les optimisations Vision ont été publiées et fusionnées dans
[Vision PR #1](https://github.com/Lumencast/lumencast-vision/pull/1) ; Solar référence
leur commit et leur merge dans son manifeste, avec les mêmes hashes d'assets qualifiés.
Le checkout canonique Vision, Prism et le serveur LSDP natif sont préservés.

[Certificat, hashes et matrice de preuves](../../evidence/local-20261005-final-certification/forge/20261005T123800Z-final-chain-certificate.json).

L'[audit de maintenance Solar du 5 octobre](../../evidence/local-20261005-solar-audit/forge/20261005T184644Z-audit.md)
complète ce certificat : reliquats supprimés, 35 modules rattachés à leurs propriétaires,
documentation courante contrôlée, 191 tests unitaires et 5 tests des gardes, build et
installation réelle du paquet vérifiés. Il ne remplace pas les preuves CEF du rendu.

## Qualification du compteur et de la rafale

La qualification actuelle utilise 512 transactions distinctes cadencées sur
2500 ms, la scène complète et la caméra physique dans Pulsar CEF. Solar reçoit
les 512 mutations séquentiellement, vérifie tous les hashes intermédiaires et les
couvre dans l'ordre sans resynchronisation. Vision termine **137 puis 144 états
distincts** dans les deux fenêtres complètes fixes de 1000 ms. La passe contient
361 présentations distinctes ; les valeurs scalaires peuvent partager une image.
Les premiers 100 ms contiennent 20 ACK natifs, 18 mutations LSML reçues et 9 états
distincts terminés. La cadence n'est pas uniforme dans chaque intervalle de 100 ms.

L'extrait prédéclaré 1–2 s contient exactement **1 s, 60 images et 60 valeurs
différentes du compteur**, lisibles et strictement croissantes, vérifiées par une
lecture indépendante de chaque image exportée. Aucun compteur ajouté ni image
interpolée. Toutes les surfaces grises sont conservées ; le compteur 512 apparaît
vers 2520 ms avec une incertitude d'alignement de ±26,2 ms. Le LSML et le LSMLZ
immutables restent inchangés ; le document muté reste en RAM.

Solar combine média et état sur un seul travail MessageChannel sans plafond RAF
à 60 Hz. Vision conserve les maillages de glyphes, réutilise les uniforms inchangés
et recompose au plus huit zones disjointes dans l'ordre des blends. La caméra et
le texte simultanés utilisent deux zones : 3 à 7 contributions de composition
par image, au lieu d'une retombée à 177 sur cette scène. Les limites de mémoire,
invalidations et chemins complets restent actifs. 40 sorties GPU exactes sont
comparées au compositeur avec le nouveau cache désactivé.

La rafale immédiate historique, avant ces optimisations, atteignait 512 ACK natifs
en 507 ms mais livrait 108 événements intermédiaires avant resynchronisation.
Ce chemin n'est pas requalifié par le test cadencé. Le tampon d'abonnement natif
reste inchangé ; sa livraison exhaustive en rafale immédiate et le temps interne
d'application du serveur ne sont pas déduits de cette preuve. Le critère 120/s
porte sur la soumission Vision suivie de la copie complète du front canvas ; le
scanout physique n'est pas mesuré. CEF est demandé à 120 Hz, la vidéo reste à 60 fps.

[Qualification actuelle, vidéo, matrice et hashes](../../evidence/local-20261005-render-cadence/forge/20261005T165339Z-qualification.md).
[Mécanismes et reproduction](render-cadence.md).
Les [échecs historiques](../../evidence/local-20261005-burst-consolidation/forge/20261005T144638Z-qualification.md)
restent conservés ; leur compteur à 23 valeurs n'est plus le résultat courant.

## Critères et preuves

Cette matrice décrit le certificat fonctionnel antérieur. Les résultats de maintenance
courants et leurs limites figurent dans l'audit lié ci-dessus.

| Critère                               | Risque vérifié                                            | Commande / preuve                                                                                                                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission Vision sans bundle de rendu | projection ou fermeture Blue incomplète                   | Canvas `ZabCanvas/scripts/prove-vision-source.py` : vraie identité ZabAuth, vraie Blue publiée via ZabGate, publication/projection/validation HTTP et SQL locales, verdict persisté ; 7 assets ; aucun verdict semé                             |
| Source et capsule Blue indissociables | mauvaise révision, digest, assets ou déclaration          | LSML/LSMLZ servis par Canvas ; manifeste auteur + définition + fermeture validée ; vérifications Solar/Orion et reprise des mêmes capsules                                                                                                      |
| Arrêt complet puis reprise            | conservation accidentelle du LSML live ou cache incomplet | Solar `scripts/prove-cold-start-cef.py --capsule ...` : deux phases, processus neufs, 4 captures CEF 1920×1080, cache/selection inchangés, zéro lecture amont hors ligne                                                                        |
| Exécution générique                   | couverture limitée à LEC/LCK                              | découverte de toutes les commandes du programme réel sur les deux lanes, reçus et erreurs ; tests génériques de tous les scopes et awaits dans Orion                                                                                            |
| Caméras peer                          | signaling, départ/retour, slot réaffecté ou libéré        | `scripts/prove-peer-camera-cef.py` : serveur Meet réel, caméra physique publiée dans un Pulsar séparé, deux viewers CEF receive-only, 10 captures, arrivée/départ/retour/réaffectation/libération                                               |
| Réception native et récupération      | état périmé, transaction incertaine, duplication          | 4 opt-in Go avec Rust release réel ; remplacement LSML et mutation structurelle ; reprise au même port et reçu perdu                                                                                                                            |
| Installation                          | scripts manquants, dépendances hoistées, binaire absent   | tarball npm installé dans un dossier neuf ; postinstall exécuté ; 161 fichiers dist identiques ; adaptateur Prism existant chargé en mémoire, client Orion réel et enfant récolé                                                                |
| Concurrence et maintenance            | course, référence morte, drift des assets                 | Solar 192 tests/26 fichiers, lint/types/reachability/pins ; Vision 144 tests Rust, 13 tests JavaScript, fmt/clippy/build WASM ; preuves fonctionnelles précédentes Orion race 1812 tests/sous-tests/22 packages et Canvas 1402 tests, ruff/mypy |
| Rendu des mutations                   | ACK ou images caméra comptés comme états affichés         | fenêtres fixes : 137 puis 144 états/s ; 60 valeurs dans 60 images CEF exportées ; tous les hashes et reçus vérifiés                                                                                                                             |
| Préservation                          | modification hors autorité                                | baselines Git Prism, LSDP natif et checkout canonique Vision identiques ; source/binaire du candidat Vision explicitement pinés                                                                                                                 |

Les tests Canvas annoncent 85 skips et un avertissement OpenAPI GET/HEAD préexistant.
Les harnais PostgreSQL, intégrations externes et santé CI ne sont pas comptés comme
des preuves réussies ; les logs de frontière et leurs raisons sont dans le certificat.
Aucune migration de schéma n'est introduite.

## Contrats stabilisés

- La source LSML conserve son adresse `scene_version`. Le programme Blue, le
  `artifact_set_digest` et la revision signée ont leurs propres identités ;
  `x-orion-artifact-set` transporte l'ensemble admis dans le document natif.
- La validation `presentation=vision` de Canvas conserve résolution/compilation
  Blue, fermeture et digests, vérifie source et assets, puis produit une admission
  sans bundle de rendu compilé. Le défaut historique `compiled` conserve uniquement
  la compatibilité du Prism actuel. Solar utilise un seul moteur Vision.
- Toute source projetée doit déclarer l'inventaire complet des assets, polices
  comprises, par leurs chemins `assets/<sha256>.<ext>`, notamment dans
  `assets.files`. Les liens implicites hors LSML ne peuvent pas être devinés.
- Le serveur commun est fourni par `@zablab/solar/server`. Le navigateur Solar
  et Orion sont consommateurs du même processus Rust ; l'hôte applicatif le possède.
- Les opérations LSDP live, résultats Blue et observations restent en RAM.
  Seuls source/assets/déclarations/programmes immuables et sélection désirée sont
  conservés. Après perte du parent, les derniers résultats dynamiques sont abandonnés.
- Un snapshot devenu périmé pendant la préparation du rendu est relu, avec quatre
  tentatives bornées et vérifications de hash intactes ; les autres erreurs restent
  visibles. Une transaction d'issue incertaine n'est pas réémise sous une nouvelle identité.
- Une libération explicite d'un slot reste vide pendant les changements de roster.
  Les feuilles caméra appartiennent à Solar et restent hors des bindings de Vision.
- Une erreur avant finalisation restaure l'ancien host/bridge/frame exact.
  Une compensation n'annule pas un effet externe déjà émis ; un reçu de dispatch
  ne prétend pas qu'un effet asynchrone est fini.

## Ce que Prism doit intégrer

1. Projeter l'inventaire complet des assets, notamment les polices, dans le LSML
   immuable, appeler la validation Canvas en mode Vision et récupérer les capsules admises.
2. Posséder le serveur natif packagé commun : origins, readiness, propagation TCP/WS,
   reprise, logout et arrêt de l'application.
3. Synchroniser source/assets/programme/déclarations au lancement, dans un stockage
   stable par compte ; réutiliser les exports Solar et le catalogue Orion existants.
4. Obtenir et renouveler les références via le flux broker autorisé existant.
   Expiration et renouvellement restent des décisions d'intégration applicative.
5. Muter la sélection souhaitée du LSML `orion.scene-control.v1` pour Program/Preview,
   puis suivre `observed` et l'acquittement du renderer.
6. Consommer les commandes, états stream-rules/Marker et erreurs Orion ;
   distribuer les capacités de capture et les rooms viewer.
7. Prouver le cycle complet de l'application installée et sa mise à jour.

## Frontières externes

La route source du Canvas **déployé** répond encore 404 : il faut publier/déployer
le candidat Canvas avant une acquisition distante par Prism. Ce n'est pas un
changement de conception supplémentaire de Solar/Orion.

Le 404 obtenu avec le bearer opérateur sur un locator **broker-only** est le refus
attendu. Il ne prouve pas une absence d'artefacts. Le flux mTLS/delegation broker
n'a pas été exercé dans cette phase et reste à vérifier dans l'intégration Prism.
La preuve actuelle emploie une clé de signature locale au producteur Canvas,
la vraie identité et la vraie compilation Blue distantes, avec HTTP/SQL locaux.

Les références réelles gardent leur durée de cinq minutes et la readiness sa minute.
La reprise démontrée est dans cette validité ; aucune autorité Blue hors ligne
indéfinie n'est ajoutée. Les six commandes découvertes sont dispatchées hors ligne
et leurs six erreurs DB_QUERY_FAILED remontent ; aucun succès métier distant
n'est revendiqué dans cette situation.

Le cache disque immuable est qualifié entre processus. Le cache IndexedDB a ses
tests de transactions/quota/éviction, mais cette preuve à froid n'est pas une preuve
de sa persistance interprocessus. Prism devra choisir le cache commun par compte.
La caméra est qualifiée en WebRTC local ; WAN/TURN et release Linux restent hors
de ces preuves Windows. La stabilité longue durée Pulsar est acceptée par l'utilisateur.

Les contrôles de workspace sont bornés aux preuves nouvelles dans leurs dépôts
et aux continuations préservées ; aucun nettoyage d'écarts historiques globaux.
Les preuves historiques restent conservées sous leurs phases d'origine. Les
anciennes mentions « gcc absent », « debug seulement », « pas de pair réel » et
« locator opérateur 404 donc artefacts manquants » sont remplacées par les résultats
et la correction de frontière ci-dessus.

## Reproduction de la consolidation

Le [générateur historique du certificat](../../evidence/local-20261005-solar-audit/forge/20261005T183100Z-historical-certify-chain.py)
est archivé avec les preuves de sa phase. Ses baselines et sa synthèse appartiennent
à ce candidat antérieur ; il ne constitue plus une commande courante et ne doit pas
réécrire ces documents. Les harnais actifs et leurs limites sont décrits dans
[le catalogue des outils](../../scripts/README.md) et
[le runbook de qualification](../runbooks/qualification.md).
