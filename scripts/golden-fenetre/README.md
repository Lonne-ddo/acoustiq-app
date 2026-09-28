# Golden de la fenêtre LAr,1h — générateur et contrôle par mutation

Deux scripts qui rendent **rejouables** les preuves du golden de
`src/utils/conformiteFenetre.ts` (fenêtre d'évaluation de la Conformité 2026 :
Ba, Bp, Kt/Ki/Kb/Ks, LAr,1h, verdict, couverture).

Aucune dépendance de dev : Node ≥ 22.18 exécute les `.ts` nativement, et
`scripts/kt-recon.loader.mjs` comble les écarts avec le résolveur de Vite.

## `generer.mjs` — figer le golden depuis le code d'origine

```
node scripts/golden-fenetre/generer.mjs            # vérifie, n'écrit rien
node scripts/golden-fenetre/generer.mjs --ecrire   # ajoute les cas nouveaux
```

Le golden (`src/utils/conformiteFenetre.golden.json`) est figé sur
**main@f01b6d9**, avant l'extraction de la fenêtre hors du composant. Le
générateur :

1. extrait par `git show f01b6d9:` `Conformite2026.tsx`, `acoustics.ts` et
   `spectraProvenance.ts` dans un dossier temporaire hors dépôt ;
2. découpe **par programme** dans le composant d'origine les helpers (`LIMITS`,
   `num`, `hhmmToMinutes`) et les corps des trois `useMemo` (`pointNames`,
   `dataByPoint`, `results`), et les assemble tels quels ;
3. les exécute sur les cas de `src/utils/conformiteFenetre.fixtures.ts` ;
4. calcule pour chaque cas le SHA-256 de la sérialisation canonique
   (`serialisationCanonique.ts`) et le résumé lisible — exactement ce que compare
   `conformiteFenetre.golden.test.ts`.

**Garde-fou** : chaque cas déjà présent dans le JSON doit être reproduit à
l'identique, sinon le générateur refuse d'écrire. Il n'ajoute que les cas
absents ; il ne réécrit jamais un cas existant. Il ne lit **jamais** le code
courant de la fenêtre : un golden régénéré depuis le code qu'il doit contrôler
ne prouverait rien.

Ajouter un cas : l'écrire dans les fixtures, lancer le générateur (il liste
`+ <cas> (nouveau)`), relire le résumé, relancer avec `--ecrire`, puis ajouter
sa couverture attendue **établie à la main** dans
`conformiteFenetre.couverture.test.ts`.

## `mutations.mjs` — un golden qu'aucune mutation ne fait tomber ne prouve rien

```
node scripts/golden-fenetre/mutations.mjs
```

Copie le projet dans un dossier temporaire (le dépôt n'est jamais modifié),
applique **une** mutation à la fois dans `conformiteFenetre.ts`, rejoue le
golden et les tests de couverture, et affiche le nombre de tests qui tombent.

- Code de sortie **1** si une mutation survit (on peut casser le calcul sans
  qu'un test bronche), ou si une mutation déclarée équivalente est tuée (la
  déclaration est fausse), ou si un motif n'est plus trouvé (le code a changé :
  mettre la liste à jour).
- Une mutation **équivalente** (le comportement ne change pas) est déclarée
  avec sa justification dans la liste. Aujourd'hui une seule : le seuil
  `ba - br < 3` du composant, redondant avec celui d'`extractBp`.

À relancer après toute modification de `conformiteFenetre.ts`, de ses fixtures
ou de ses tests.

### Historique

L'audit du 2026-09-28 a trouvé cinq mutations survivantes : **Kb forcé à 0**
et **Ki manuel ignoré** (deux termes correctifs réglementaires qu'on pouvait
casser sans qu'un test bronche : toutes les fixtures avaient LCeq − LAeq = 9 dB
et un LAFTeq), le verdict `<` au lieu de `<=`, la priorité des statuts de
couverture et la borne de fin de période. Cinq cas ajoutés (`kb-auto`,
`ki-manuel`, `verdict-egalite`, `priorite-statuts`, `borne-fin`) : toutes les
mutations non équivalentes sont désormais tuées.
