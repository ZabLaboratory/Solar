# Cache de sources immuables

Propriétaires : src/scenes/cache.ts, startup.ts et browser-store.ts ; stockage
Node : src/server/scene-store.ts ; démarrage servi : src/host-entry.ts.

createCachedSceneSourceProvider compose un fournisseur Canvas et SceneSourceStore.
Une requête sans version découvre la révision sur Canvas. Une requête exacte
utilise la capsule locale vérifiée, sans réseau ; un miss acquiert puis conserve
la source publiée. Une capsule corrompue échoue explicitement sans changer de scène.

La capsule solar.scene-cache.v1 conserve les octets LSMLZ, ou LSML et assets,
ainsi que le manifeste Blue complet. Chaque lecture revalide l'adresse LSML,
le digest des octets source/transport, les assets hashés et la fermeture Blue.
offline_ready et binding_closure_complete doivent être vrais. Modifier le LSML
sans changer son adresse est refusé même si son digest d'octets est recalculé.

FileSceneSourceStore publie une seule fois par staging/link atomique dans le même
dossier. Une publication concurrente identique est idempotente ; un contenu
différent refuse SOURCE_CACHE_KEY_CONFLICT et préserve la capsule acceptée.
Les clés sont SHA-256(id, version, format), jamais un chemin utilisateur.
Les tailles d'archive, d'assets et les expansions ZIP sont bornées.

```ts
// Hôte Node/Electron ; transférer les sources à la frontière de rendu existante.
import { FileSceneSourceStore, createCachedSceneSourceProvider } from "@zablab/solar/server";
const provider = createCachedSceneSourceProvider(canvasProvider,
  new FileSceneSourceStore(accountOwnedSourceDirectory));
const scene = await provider.get(sceneId, { sceneVersion, format: "lsmlz" });
```

Le host Solar synchronise au lancement le catalogue Canvas (mine=true, pagination
50), borné à 64 scènes et une réponse catalogue de 512 KiB. Une entrée non publiée
ou incomplète reste un échec partiel visible dans le dataset solarCache ; la scène
active peut continuer via le fournisseur en ligne. Seules les révisions exactes
avec fermeture Blue complète sont conservées. Un hit vérifié fonctionne sans
réseau ; une capsule corrompue échoue sans substitution silencieuse.

BrowserSceneSourceStore partage une transaction IndexedDB entre les deux lanes,
avec partition SHA-256(API, credential), 64 entrées et 512 MiB, éviction par accès.
Le credential n'est pas écrit. Sa rotation ouvre une nouvelle partition, et
IndexedDB dépend de l'origine du host ; cette politique conservatrice n'affirme
pas un cache unifié entre origines ou tokens. L'hôte Node peut fournir le store
de fichiers par identité stable lorsque l'intégration applicative sera reprise.
Prism n'a pas été modifié. Le runtime ne sauvegarde jamais le LSML live muté.
Le cache de rendu n'autorise pas Blue : Orion conserve son admission des capsules
signées/programmes. Un manifeste valide par digest n'est pas une signature.

L'adresse source `scene_version` est distincte du `artifact_set_digest` admis
par Orion. Les documents Solar natifs conservent la première et portent la
seconde sous `x-orion-artifact-set`. Le manifeste Blue porte l'adresse source ;
le catalogue Orion conserve le programme signé et les déclarations associées.

`scripts/prove-cold-start-cef.py` exerce FileSceneSourceStore et le catalogue
Orion après arrêt complet des processus : deux nouvelles instances CEF reprennent
Program/Preview, source/assets/déclarations inchangés, mutations live abandonnées.
Le harnais sert le cache Node vérifié aux CEF si nécessaire. Il ne certifie pas
la persistance IndexedDB entre processus. Sans `--capsule`, le manifeste et les
signatures sont des fixtures de contrat explicitement déclarées. Avec
`--capsule`, il consomme le résultat HTTP/SQL réellement validé et signé par le
Canvas local, qui a utilisé l'identité ZabAuth et la Blue publiée via ZabGate.
La clé reste locale au producteur ; ce n'est pas un déploiement Canvas distant.
`scripts/prove-authenticated-canvas.mjs` qualifie séparément login, référence
signée réelle et acquisition source LSMLZ/LSML. Le locator broker-only refuse le
bearer opérateur comme prévu ; sa récupération mTLS est une preuve séparée.
Voir [maturité et certificat](maturity.md).

Tests : scene-cache.test.ts, scene-store.test.ts, startup-cache.test.ts. check:source-usage couvre les
modules accessibles depuis les quatre entrées ; tsc/eslint couvrent les symboles.
Cette analyse ne promet pas de détecter tous les usages externes/dynamiques.
