# Checkpoint — Solar native worker delivery

- Unité : `local-20261015-worker-delivery`.
- Worktree : `D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-worker-delivery`.
- Branche : `eleven/local-20261015-worker-delivery`.
- Base et HEAD avant correctif : `774c5e85dca6e12df9d0fb8742f9e9b500d507e7` (intégration Root).
- Propriétaire : `src/engine/native-worker-client.ts`, `tests/unit/native-worker-client.test.ts`, `src/engine/README.md` et les preuves de cette unité.

## Résultat

Les mesures Performance de la livraison worker sont maintenant best-effort : exceptions de `performance.getEntriesByName`, `performance.clearMeasures`, `performance.measure`, ou lecture d'horloge invalide ne doivent pas interrompre les transactions ni empoisonner la file ordonnée. Le code réutilise `measureStage` existant.

Lorsqu'une admission main échoue, la réponse au Worker garde le message et le `code` d'erreur optionnel. `native-worker.ts` réhydrate ensuite ces champs sur l'erreur rejetée; le test vérifie le trajet main → réponse worker et confirme qu'aucun reçu de succès n'est émis. L'échec de `onIncomingFailed` est transmis à `onClose` s'il est défini, après l'envoi de la réponse d'échec initiale.

## Vérifications

- Reproduction avant correction : un `getEntriesByName` ou `measure` qui lève empêchait l'envoi du reçu et laissait la file rejetée; un `onIncomingFailed` qui lève empêchait aussi le traitement des notifications suivantes.
- Après correction : Vitest 4.1.5, 1 fichier, 9 tests réussis. Les scénarios Performance lancent deux notifications et vérifient deux réponses en ordre; le scénario d'erreur typée vérifie `ADMISSION_FAILED`, l'absence de succès pour la première notification et le succès de la suivante.
- TypeScript strict ciblé — réussi.
- Prettier `--check` sur les trois fichiers produit — réussi.
- `git diff --check` — réussi.
- Espace disque D: libre au contrôle final : 335 847 424 octets (environ 320,5 MiB), au-dessus du plancher de 250 MiB.

Commandes de validation (dépendances réutilisées depuis le worktree d'intégration) :

```powershell
node 'D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-project-integration\node_modules\vitest\vitest.mjs' run --config 'D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-project-integration\vitest.config.ts' --root 'D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-worker-delivery' tests/unit/native-worker-client.test.ts
node 'D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-project-integration\node_modules\typescript\bin\tsc' --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution bundler --strict --noUncheckedIndexedAccess --noImplicitOverride --noFallthroughCasesInSwitch --noUnusedLocals --noUnusedParameters --allowSyntheticDefaultImports --esModuleInterop --verbatimModuleSyntax --isolatedModules --skipLibCheck --types node,vitest/globals,vite/client tests/unit/native-worker-client.test.ts
node 'D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-project-integration\node_modules\prettier\bin\prettier.cjs' --check --config 'D:\Documents\Zab\Solar\.worktrees\eleven-local-20261015-project-integration\.prettierrc.json' src/engine/native-worker-client.ts tests/unit/native-worker-client.test.ts src/engine/README.md
git diff --check
```

Les dépendances du worktree d'intégration ont été réutilisées par lecture via un junction local ignoré; aucune installation, compilation, génération de média, modification de DLL active, ni redémarrage runtime n'a eu lieu. Le build JavaScript complet et les contrôles intégrés restent à la charge de Root. Aucun travail de transition/switch n'est inclus.

## Fichiers du lot

- `src/engine/native-worker-client.ts`
- `tests/unit/native-worker-client.test.ts`
- `src/engine/README.md`
- `evidence/local-20261015-worker-delivery/eleven/20261015T081628Z-agent-start.md`