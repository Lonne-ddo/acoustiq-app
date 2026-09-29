# Golden des parseurs sur relevés de plus de 24 h (#19)

Preuve de NON-RÉGRESSION des parseurs (`parseCsv`, `parseWorkbook`) sur des
relevés qui traversent minuit et le changement d'heure, figée **avant** la
correction de #19. Plan du chantier : `docs/chantier-19.md`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/modules/parseurs24h.fixtures.ts` | 7 relevés synthétiques déterministes au format réel (trois détecteurs, deux minuits, heure d'été, heure normale, Summary daté de la veille) |
| `src/modules/parseurs24h.golden.ts` | exécution d'un cas par le chemin exact de l'app + résumé + empreinte (partagé test / générateur) |
| `src/modules/parseurs24h.golden.json` | golden figé sur main@10671c5 |
| `src/modules/parseurs24h.golden.test.ts` | égalité stricte (empreinte de la sortie complète + résumé) |
| `generer.mjs` | vérifie / ajoute des cas (jamais de réécriture d'un cas existant) |
| `mutations.mjs` | contrôle par mutation du golden |
| `reel.mjs` | golden LOCAL sur les CSV réels de `.local-data/` |

## Ce que le golden fige (défauts compris)

- `t` **replié à minuit** : chaque relevé de 31 h présente deux retours en
  arrière de `t` (1439 → 0) et une seule `date` ;
- date **summary-first** du G4-EN : Summary daté de la veille ⇒ `date` décalée
  d'un jour par rapport aux données ;
- retour à l'heure normale : l'heure murale 01:xx vue deux fois ⇒ 60 instants
  répétés ;
- gigue du flottant sur `t` (ex. 1081,0000000032596 pour 18:01).

Sur le CSV réel `821SE_40489-250703000` (golden local) : 107 202 échantillons,
un retour à minuit, **20 802 instants répétés** (le 4 juillet 11:13–17:00
superposé au 3).

## Faire évoluer le golden

La correction de #19 change VOLONTAIREMENT ces sorties. Procédure :

1. retirer du JSON les seuls cas dont le changement est attendu ;
2. relancer `generer.mjs` (il liste les cas nouveaux et leur résumé) ;
3. écrire dans `docs/chantier-19.md` le tableau « avant / après / justification »
   de chaque cas changé ;
4. `generer.mjs --ecrire`.

Tout cas non listé doit rester identique : le générateur refuse d'écrire sinon.

## Contrôle par mutation

`node scripts/golden-parseurs-24h/mutations.mjs` — copie hors dépôt, une
mutation à la fois dans le chemin temps/date. Au 2026-09-28 : 7/7 tuées. P2 et
P3 (« date du fichier prise sur la DERNIÈRE ligne ») ne sont tuées que par les
relevés de plus de 24 h ; P5 (G4-EN en data-first) seulement par le cas
« Summary daté de la veille ».

## Golden local sur données réelles

```
node scripts/golden-parseurs-24h/reel.mjs fige      # une fois, avant la correction
node scripts/golden-parseurs-24h/reel.mjs compare
```

Écrit dans `.local-data/golden-parseurs-24h.local.json` (gitignoré). Seuls les
CSV sont traités : les feuilles 1 s des xlsx de plus de 24 h dépassent ce que
SheetJS peut lire.
