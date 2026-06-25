# Runbook — Release Solar et consommation par Orion

**Restauré par** : PR Solar #27 (`879510d`) — branche `keeper/solar-release-pipeline`  
**Date** : 2026-06-24  
**Scope** : flux release Solar → GitHub Release → déploiement Orion VPS

---

## Contexte et dette

PR Solar #26 (`7fd68de`) avait supprimé `release.yml` et `ci.yml` en basculant sur
des hot-pushes manuels de `dist/` vers le VPS. Conséquences :

- v0.2.10 et v0.2.11 ont été installées manuellement sur le VPS sans GitHub Release.
- **Une fresh-box est irreconstruisible** : aucune source versionnée pour récupérer ces tarballs.
- Le contrat d'asset (`solar-<tag>.tgz`, layout plat de `dist/`) attendu par
  `Orion deploy.yml` n'était plus alimenté.

PR #27 restaure le mécanisme de release automatisé. La dette résiduelle est listée
en fin de document.

---

## Flux release → deploy

### 1. Déclencheur : tag semver sur Solar

Un push de tag `v*.*.*` sur le repo Solar déclenche `release.yml`
(branche `keeper/solar-release-pipeline`, à merger sur `main`).

### 2. Build sur les runners self-hosted

Le job tourne sur `[self-hosted, vps-ovh]` — le billing GitHub Actions est gelé
sur l'organisation, les runners ubuntu-latest ne sont pas disponibles.

Séquence du job :

1. `npm ci` (pas de cache npm — les runners JIT sont éphémères, le cache ne serait
   jamais réutilisé, cf. note Orion `setup-go cache disabled`)
2. `lint` → `typecheck` → `vitest` → `build` → `check:bundle`
3. Playwright Chromium installé sans `--with-deps` (runner non-root nosuid,
   les dépendances OS sont bakées dans l'image du pool)
4. `test:e2e`
5. Vérification que `package.json version` correspond au tag (échoue le job si dérive)
6. Pack : `tar -czf release/solar-<tag>.tgz -C dist .` — pack plat de `dist/`
7. Publication en GitHub Release via `softprops/action-gh-release@v2`
   (notes de release auto-générées)

### 3. Asset publié

Nom : `solar-<tag>.tgz`  
URL de download (publique, sans token) :
```
https://github.com/ZabLaboratory/Solar/releases/download/<tag>/solar-<tag>.tgz
```

Layout de l'archive : contenu de `dist/` à la racine du tgz (pack plat,
`tar -C dist .`). **Ce layout est un contrat avec Orion `deploy.yml` — ne pas modifier
sans aligner simultanément le step d'extraction Orion.**

### 4. Consommation par Orion (deploy.yml)

Le job « Install Solar bundles » de `Orion deploy.yml` tourne après le rsync du code.
Variable d'environnement `SOLAR_VERSIONS` (ex. `"v0.2.8 v0.2.9"`) liste les versions
à installer.

Pour chaque version :

1. SSH vers VPS, `mkdir -p $APP_PATH/solar/<version>`
2. Si `.installed` présent → skip (idempotent)
3. `curl -fsSL --retry 3` vers l'URL de release Solar (anonyme, repo public)
4. `tar -xzf` dans `$APP_PATH/solar/<version>/`
5. `touch .installed` (marqueur de succès — un download partiel laisse la version
   sans marqueur, le prochain deploy retente)

Le rsync Orion exclut `solar/` via `--exclude 'solar'` : les versions installées
survivent aux re-deploys sans être écrasées.

### 5. Service par Orion

Orion monte `$APP_PATH/solar/` (alias `ORION_SOLAR_ROOT`, défaut `/var/lib/orion/solar`)
en volume read-only dans le container (`docker-compose.prod.yml`).

L'handler Go `internal/api/static.go` sert les fichiers sous :
```
GET /static/solar/v{N.N.N}/<fichier>
```
Via ZabGate : `GET /orion/static/solar/<version>/index.html`

Consommateurs :
- **Pulsar CEF** (browser-source antenne) : pointe vers `host/index.html?orion=...&mode=broadcast`
- **Prism** : vendor les bundles Solar dans `resources/solar/v{N.N.N}/`

Health-check de présence d'une version (suit la redirection 301 → `./`) :
```bash
curl -fsSL -o /dev/null -w '%{http_code}\n' \
  https://zabgate.cyell.dev/orion/static/solar/<version>/index.html
# attendu : 200
```

---

## Procédure de cut (publier une nouvelle version Solar)

1. Bumper `version` dans `package.json` (ex. `0.2.12`).
2. Commit `release: vX.Y.Z`, push sur `main` (ou merger la PR).
3. Tagger : `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. `release.yml` se déclenche sur le tag. Vérifier que le job passe sur
   l'interface Actions (runner `vps-ovh`).
5. Vérifier la GitHub Release créée + présence de l'asset `solar-vX.Y.Z.tgz`.
6. **Aligner Orion** : PR sur `Orion deploy.yml` pour ajouter `vX.Y.Z` à `SOLAR_VERSIONS`.
   Merger → le deploy Orion installe la version.
7. Health-check via gateway (commande ci-dessus).
8. Pointer Pulsar browser-source vers la nouvelle version si roll-forward.

---

## Rollback

Le mécanisme de release Solar ne modifie aucun état sur le VPS seul : le
marqueur `.installed` et le répertoire de version ne sont écrits que par
`Orion deploy.yml`.

Pour revenir à une version précédente :
1. Pointer le browser-source Pulsar vers la version précédente (ex. `v0.2.9`) —
   les versions installées coexistent sur le VPS, switch instantané sans redeploy Orion.
2. Retirer la version cible de `SOLAR_VERSIONS` dans `Orion deploy.yml` si
   on veut éviter qu'elle soit réinstallée (optionnel, le `.installed` l'idempotentise).

Il n'y a pas de rollback de la GitHub Release elle-même (l'asset restera
accessible) — révoquer un tag Solar n'a aucun effet sur le VPS déjà installé.

---

## Dette résiduelle

| Poste | État | Porteur |
|---|---|---|
| `SOLAR_VERSIONS` Orion (`"v0.2.8 v0.2.9"`) non aligné sur les versions disponibles (`v0.2.10`, `v0.2.11`) | En cours | Keeper |
| `ci.yml` Solar non restauré (gate PR optionnelle) | Différé (pas bloquant pour la release) | — |
| Premier cut viewer WebRTC (#3/#4) | En attente validation porteur + RC-Q | — |

---

## Invariants du contrat d'asset (ne pas casser)

- Nom de l'asset : `solar-<tag>.tgz` (tag incluant le `v`, ex. `solar-v0.2.12.tgz`)
- Layout : pack plat de `dist/` (`tar -C dist .`) — `index.html` à la racine du tgz
- URL : `releases/download/<tag>/solar-<tag>.tgz` — download anonyme (repo public)
- Destination VPS : `$ORION_SOLAR_ROOT/<tag>/` (ex. `/var/lib/orion/solar/v0.2.12/`)
- Route Orion : `GET /static/solar/<tag>/*` → `ORION_SOLAR_ROOT/<tag>/*`

Toute modification de l'un de ces points nécessite une PR simultanée sur
Solar `release.yml` ET Orion `deploy.yml`.
