# SheetJS (`xlsx`) — dépendance vendorisée

AcoustiQ lit les classeurs Excel (831C, 821SE, Lp, ECME, carrière) avec
SheetJS Community Edition. La version utilisée **n'est pas installée depuis
le registre npm** : elle est versionnée dans le dépôt.

## Provenance

| | |
|---|---|
| Fichier | `vendor/xlsx-0.20.3.tgz` |
| Version | 0.20.3 (dernière publiée au 2026-09-23 : `xlsx-latest` → 0.20.3) |
| Source | https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz |
| SHA-256 | `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8` |
| Intégrité npm (lockfile) | `sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==` |
| Déclaration | `package.json` : `"xlsx": "file:vendor/xlsx-0.20.3.tgz"` |
| Licence | Apache-2.0 |

Le CDN ne publie pas d'empreinte (`…tgz.sha256` → 404) : la SHA-256 ci-dessus
a été calculée au téléchargement.

### Pourquoi vendoriser

L'éditeur a quitté le registre npm après 0.18.5. Cette version est vulnérable
sur le chemin de LECTURE — GHSA-4r6h-8v6p-xvw6 (pollution de prototype,
corrigée en 0.19.3) et GHSA-5pgg-2g8v-p4x9 (ReDoS, corrigée en 0.20.2) —,
déclenchables par un fichier fourni par l'utilisateur. Les correctifs n'existent
que sur `cdn.sheetjs.com`. Vendoriser plutôt que pointer l'URL du CDN : une
installation hors-ligne, reproductible, indépendante de la disponibilité du CDN
et du proxy TLS du poste (voir `docs/issues.md` #5).

### `npm audit` ne surveille plus `xlsx` — c'est attendu, et à compenser

Constaté le 2026-09-23 après installation : `npm audit` ne signale **plus
rien** sur `xlsx`. Une dépendance `file:` n'est pas confrontée au registre
npm — ni les anciens avis (corrigés en 0.20.3), ni d'éventuels FUTURS avis.
Ce silence n'est pas une garantie : la veille de sécurité sur SheetJS est
**manuelle** (avis GitHub de SheetJS, https://cdn.sheetjs.com/ ; à revoir au
moins à chaque montée de version). Vérifier la version réellement installée :

```sh
node -p "require('xlsx').version"   # doit afficher 0.20.3
```

## Mettre à jour à la main

1. Vérifier la dernière version : https://cdn.sheetjs.com/ (ou
   `curl -s https://cdn.sheetjs.com/xlsx-latest/package/package.json`).
2. Télécharger le tarball dans `vendor/` et calculer son empreinte :
   ```sh
   curl -o vendor/xlsx-X.Y.Z.tgz https://cdn.sheetjs.com/xlsx-X.Y.Z/xlsx-X.Y.Z.tgz
   sha256sum vendor/xlsx-X.Y.Z.tgz
   ```
   (Poste Englobe : `export NODE_OPTIONS=--use-system-ca` pour npm.)
3. **Avant d'installer**, rejouer le golden contre la nouvelle version, sans
   toucher au dépôt (voir ci-dessous, variable `XLSX_IMPL`). Tout écart est
   analysé et, s'il est accepté, documenté dans `ecartsAcceptes`.
4. Installer : `npm install ./vendor/xlsx-X.Y.Z.tgz`, supprimer l'ancien
   tarball, mettre à jour ce document (version, SHA-256, intégrité du lockfile).
5. `npx vitest run && npx tsc -b && npm run build`, puis le golden en mode
   `compare` sur la version installée.

## Golden de non-régression des parseurs

`scripts/sheetjs-golden/` — même méthode que le golden Kt : sorties de
référence figées AVANT le changement de version, égalité stricte attendue
APRÈS.

- `golden.mjs` exécute chaque parseur de lecture sur chaque fichier de
  `.local-data/` (gitignoré, fichiers réels) et compare la sortie COMPLÈTE,
  sérialisée canoniquement (`NaN`, `±Infinity`, `-0`, `undefined`, dates
  distingués), par SHA-256 ; une erreur est comparée par son message exact.
- `golden-0.18.5.json` : références figées avec 0.18.5 le 2026-09-23.
- `loader.mjs` / `xlsx-shim.mjs` : exécution des sources TypeScript sous Node,
  avec `xlsx` substituable.

```sh
# comparer la version installée au golden
node scripts/sheetjs-golden/golden.mjs compare scripts/sheetjs-golden/golden-0.18.5.json [filtre]
# essayer une autre version sans l'installer (paquet extrait du tarball)
XLSX_IMPL=/chemin/package node scripts/sheetjs-golden/golden.mjs compare … [filtre]
# figer un nouveau golden (ajoute/remplace les entrées des fichiers traités)
node scripts/sheetjs-golden/golden.mjs fige <golden.json> [filtre]
```

`crypto.randomUUID` (id des `MeasurementFile`) est rendu déterministe dans le
harnais : sans cela, deux exécutions de la même version diffèrent.

### Résultat 0.18.5 → 0.20.3 (2026-09-23)

| Fichiers | Résultat |
|---|---|
| six 821SE du 2025-03-11 | égalité stricte 36/36 |
| 831C `…26070700.LD0.xlsx` | 5/6 + 1 écart ACCEPTÉ |

**Écart accepté** — 831C × `parseEcmeFile`, `occupation[16..18].modele` :
cellule horaire pure (sérial < 1) lue avec `cellDates: true`. La part de date
est le sérial 0 = **31 déc. 1899** dans le système Excel : 0.20.3 a raison ; le
30 déc. 1899 de 0.18.5 était l'ancien décalage de SheetJS. Non neutralisé. (Le
831C passé au parseur ECME n'est pas un cas d'usage réel — voir issue #8.)

### Couverture — limites connues

- **Parseurs ECME et carrière NON couverts** : aucun fichier ECME ni carrière
  réel dans `.local-data/`. `parseCamionnageSheet` et `parseMeteoSheet`
  échouent sur tous les fichiers (seul le message d'erreur est comparé) ;
  `parseEcmeFile` et `parseTimeHistorySheet` ne tournent que sur des fichiers
  qui ne sont pas les leurs. Leurs modules sont masqués
  (`src/config/features.ts` : `parcEcme: false`, `carriere: false`).
  **À couvrir par un golden sur fichiers réels AVANT tout démasquage** — ce
  sont justement ceux qui lisent en `cellDates: true`, où la convention de date
  de 0.20.3 se manifeste.
- Fichiers de plus de 100 Mo non passés (la lecture intégrale y dépasse
  25 min ; le décalage observé est une convention d'époque, indépendante de la
  taille).
- CSV non concernés (lus par `csvParser`, sans SheetJS).
- Écriture (`XLSX.writeFile`, 8 exports) hors golden ; l'export météo est écrit
  avec ExcelJS (`src/utils/meteoExcel.ts`).
