# Problèmes connus

Registre des anomalies constatées mais NON corrigées. Chaque entrée décrit le
symptôme, le chemin de code en cause et l'impact. Un correctif mérite sa propre
branche : ne pas corriger ici au passage d'un autre travail.

---

## #1 — La date du Sommaire écrase la date réelle des données (831C, micrologiciel 04.9.6R1)

**Statut** : ouvert, non corrigé.
**Sévérité** : haute — fausse le regroupement point/date, donc les résultats de
conformité et l'analyse tonale, sans aucun message d'erreur.

### Symptôme

Sur un export 831C en anglais dont la feuille « Summary » porte une date
erronée (constaté avec le micrologiciel **04.9.6R1**), `MeasurementFile.date`
prend la date du Sommaire et non celle du premier point de données. Le fichier
est parsé correctement, ses données sont bonnes, mais il est étiqueté au mauvais
jour.

### Chemin de code

1. `src/modules/formatDetectors.ts:706-709` — la date retenue dépend de la
   stratégie du détecteur :

   ```ts
   const firstDataDate = serialDaysToISO(firstDays)
   const date = match.dateStrategy === 'summary-first'
     ? (meta.startDate || firstDataDate || '')   // ← Sommaire PRIORITAIRE
     : (firstDataDate || meta.startDate || '')
   ```

   `meta.startDate` vient de `readMeta` (`formatDetectors.ts:193`), qui lit une
   cellule à position FIXE de la feuille Sommaire (`raw(3, 1)`). Elle n'est
   jamais recoupée avec l'horodatage des données.

2. Le détecteur concerné est **G4 anglais** (`formatDetectors.ts:463`,
   `dateStrategy: 'summary-first'`). Les détecteurs français sont en
   `data-first` (`:487`, `:514`) et ne sont donc pas touchés.

3. `date` devient la clé de jointure de toute l'analyse de conformité :
   - `src/components/Conformite2026.tsx:201` —
     `files.filter((f) => pointMap[f.id] === pt && f.date === selectedDate)` ;
   - `src/utils/spectraProvenance.ts:55` —
     `if (pointMap[f.id] !== point || f.date !== date) continue`.

### Conséquences

- Le fichier n'apparaît pas sous la date attendue : le point de mesure paraît
  vide, ou pire, n'agrège qu'une partie de ses fichiers.
- `spectraFreqsForPoint` ne retrouve pas les fréquences du fichier écarté. Sans
  fréquences, l'analyse tonale refuse de produire un Kt
  (`acoustics.ts`, motif `alignement-non-verifiable`). Le refus est correct en
  soi, mais sa cause réelle — une date fausse — reste invisible pour
  l'acousticien.
- Aucun avertissement n'est émis : la date du Sommaire est prise sur parole.

### Piste de correction (à instruire dans une branche dédiée)

Recouper `meta.startDate` avec `firstDataDate` et, en cas de divergence,
trancher en faveur des données (qui sont l'observation) tout en signalant
l'écart, plutôt que de laisser une métadonnée non vérifiée décider seule.
Choisir entre : inverser la priorité pour `summary-first`, ou conserver la
priorité mais invalider `meta.startDate` quand il s'écarte de `firstDataDate`
au-delà d'une tolérance.

### État de vérification

- Vérifié par lecture du code : les trois emplacements ci-dessus et la priorité
  `summary-first`.
- **Non reproduit localement** : aucun export de micrologiciel 04.9.6R1 n'est
  disponible sur ce poste. Le seul 831C réel présent est un export FRANÇAIS
  (micrologiciel 5.1.2R16, feuille « Sommaire »), donc traité en `data-first` —
  il ne déclenche pas le défaut. Reproduction à refaire sur un fichier 04.9.6R1
  avant de valider un correctif.

### Observation connexe (même lecture, à instruire avec)

`readMeta` (`formatDetectors.ts:171-197`) lit le Sommaire à des lignes FIXES
(modèle en `(1,1)`, série en `(2,1)`, début en `(3,1)`, fin en `(4,1)`). Sur
l'export français examiné, la disposition réelle est décalée : `(3,1)` contient
le **numéro de série** (`12782`) et `(4,1)` le modèle. `excelDateToISO(12782)`
produit alors une date de 1934 dans `meta.startDate`. Le défaut est masqué
aujourd'hui parce que les détecteurs français sont en `data-first` et ignorent
`meta.startDate` — mais la métadonnée est bel et bien fausse, et `model` /
`serial` le sont aussi pour ces fichiers.

---

## #2 — `KT_BAND_FREQS` s'arrête à 50 Hz – 10 kHz : 10 kHz est inévaluable pour rien

**Statut** : ouvert, non corrigé. Aucun correctif ici.
**Sévérité** : moyenne — pas de résultat faux, mais un angle mort de détection
évitable.

### Constat

`KT_BAND_FREQS` (`src/utils/acoustics.ts:624-628`) couvre 24 bandes 1/3
d'octave, de **50 Hz à 10 kHz**. `analyzeKt` calcule les émergences entre
bandes adjacentes **de cette table** : la première et la dernière n'ont qu'un
seul voisin, donc `diffPrev` ou `diffNext` vaut `null`, donc `isBoundary` est
vrai, donc `isTonal` est **faux par construction** (`acoustics.ts:879-888`).

**Une tonalité pure à 50 Hz ou à 10 kHz ne peut donc jamais déclencher Kt**,
quelle que soit son émergence. Vérifié : un pic à 80 dB sur fond 50 dB dans ces
deux bandes donne `kt = 0`. Figé comme invariant dans
`src/utils/ktNonRegression.test.ts`, cas (d).

### Le vrai problème : 10 kHz est bande de bord **par troncature**, pas par nature

La voisine haute de 10 kHz — **12,5 kHz — est présente dans la donnée**. Le
bloc positionnel 831C porte 27 bandes jusqu'à 20 kHz (`SE831C_FREQ_BANDS`,
`formatDetectors.ts:35-39`) ; les exports à bandes nommées en portent jusqu'à
36 depuis 6,3 Hz. L'information nécessaire pour évaluer 10 kHz **est là, dans
le fichier**, et le calcul la jette. 10 kHz n'est inévaluable que parce que la
table d'analyse s'arrête pile dessus.

(Le cas de 50 Hz est différent : sa voisine basse 40 Hz n'existe que dans les
exports à bandes nommées, pas dans le bloc positionnel 831C qui commence à
50 Hz. Traiter 50 Hz demande donc un arbitrage séparé, et il reste bande de
bord pour le 831C positionnel quoi qu'on fasse.)

### Distinguer plage ANALYSÉE et plage EXIGÉE

Depuis l'indexation par fréquence, `KT_BAND_FREQS` joue **deux rôles à la
fois**, et c'est la confusion des deux qui donne l'impression d'un dilemme :

1. **plage analysée** — les bandes pour lesquelles on cherche une tonalité ;
2. **plage exigée** — les bandes dont l'absence fait refuser le calcul
   (`bande-analyse-absente`, `ktLevelsByFrequency`, `acoustics.ts:795-808`).

Les séparer lève la tension. **Élargir l'analyse à 12,5 – 20 kHz sans élargir
l'exigence** : les bandes au-delà de 10 kHz servent uniquement de **voisines**
pour les Δ, utilisées **quand elles sont présentes**, jamais requises. Effets :

- **831C positionnel** (27 bandes, 50 Hz → 20 kHz) : reste calculable, et
  **gagne 10 kHz** — sa voisine 12,5 kHz est là.
- **exports à bandes nommées** (36 bandes, 6,3 Hz → 20 kHz) : restent
  calculables, gagnent 10 kHz de la même façon.
- **fichier limité à 50 Hz – 10 kHz exactement** (24 bandes) : reste
  calculable, et 10 kHz y demeure bande de bord — correctement cette fois,
  puisque sa voisine est réellement absente de la mesure.

Aucun format ne devient non calculable. La note d'en-tête de `KT_BAND_FREQS`
(`acoustics.ts:615-622`) présente l'élargissement comme un compromis entre
couverture et calculabilité : **ce compromis n'existe pas** dès lors que les
deux rôles sont séparés. Cette entrée remplace cette lecture.

### Ce qui reste à trancher

Non pas la faisabilité, mais la **méthode réglementaire** : les Lignes
directrices MELCCFP 2026 (§3.7.4, Tableau 2) fixent des seuils par bande, et il
faut confirmer avec un acousticien que l'analyse tonale s'étend légitimement
au-delà de 10 kHz — et, si oui, jusqu'où. La réponse décide si l'élargissement
est une correction de calcul ou un changement de méthode. Le sort de 50 Hz se
tranche dans le même mouvement.

---

## #3 — Comparaison de seuil tonal : `>= 15 / 8 / 5` dans le code, `> 14,5 / 7,5 / 4,5` dans le gabarit

**Statut** : **fermé — le code est correct, aucune modification.**

### Conclusion

La Note 98-01 (annexe IV, Tableau 4) et les Lignes directrices MELCCFP 2026
(§3.7.4, Tableau 2) ont un contenu identique et écrivent toutes deux
« 15 dB et plus » (125 Hz et moins), « 8 dB et plus » (160 à 400 Hz),
« 5 dB et plus » (500 Hz et plus). `>=` sur la valeur entière est la lecture
littérale : c'est ce que fait le code. Le gabarit `Bruit_tonal.xls` encode un
arrondi au dB entier (`> 4,5` ≈ « arrondi ≥ 5 »), ce qui n'est pas le texte.

Constat connexe corrigé à la même occasion : le code 98-01 appliquait 15 dB à
160 Hz ; il applique désormais 8 dB, conformément au Tableau 4 (les deux
cadres partagent `ktThreshold`).

### Constat initial

Le gabarit `Bruit_tonal.xls` compare Δ > 14,5 / 7,5 / 4,5, le code compare
Δ >= 15 / 8 / 5 :

- cadre 2026 : `src/utils/acoustics.ts:886-887` ;
- cadre 98-01 : `src/utils/acoustics.ts:1097-1098`.

Sur Δ dans ]4,5 ; 5[ le gabarit détecte une tonalité que le code rate —
direction défavorable (Kt non appliqué, conformité déclarée à tort). Même
divergence sur ]7,5 ; 8[ et ]14,5 ; 15[. À Δ = 4,5 exactement, les deux
concluent « non tonal ».

Hypothèse initiale : le gabarit encode un arrondi au dB entier — à trancher
contre la note 98-01. Tranché ci-dessus.

---

## #4 — 821SE xlsx : `branche=n/a` dans la synthèse de kt-recon, fenêtre d'évaluation vide

**Statut** : ouvert, non corrigé. Aucun correctif ici.

### Constat

Dans la SYNTHÈSE de `scripts/kt-recon.mjs`, les six 821SE xlsx de
`.local-data/` datés du 2025-03-11 (`40488-250311000/002/003/005/006`,
`40489-250311003`) sortent `branche=n/a` : aucun Kt, et la ligne de synthèse ne
dit pas pourquoi.

### Ce que montre le détail par fichier (même exécution)

Le motif existe, il n'est simplement pas repris dans la synthèse :

- **le parseur les prend en charge** : 302 à 1083 lignes, date parsée
  2025-03-11, `spectraSource` A-déponderé, 36 bandes 6,3 Hz → 20 kHz ;
- **la fenêtre [14:00, 15:00[ est vide** (0 point) : ce sont des mesures
  courtes du matin (heures de début dans les noms : 09:43 → 12:08). Le script
  impose la fenêtre par défaut de l'UI (`evalHour = '14:00'`,
  `src/components/Conformite2026.tsx:169`) et s'arrête là, comme l'UI
  (`Conformite2026.tsx:247`).

Ce n'est donc pas, en l'état, une classe de fichiers que le parseur rejette :
c'est une fenêtre d'évaluation qui ne recoupe pas la mesure.

### À vérifier

1. **Synthèse kt-recon** (`scripts/kt-recon.body.mjs`, boucle SYNTHÈSE) :
   `n/a` confond « fenêtre vide », « aucun spectre » et « ref git
   introuvable ». Elle devrait reprendre le motif du détail.
2. **Comportement de l'app sur fenêtre vide** : `Conformite2026.tsx:247-268`
   rend `bpReason: 'noData'`, `pass: null`, `ktAnalysis: null` — mais aussi
   `kt: 0`. Vérifier que l'UI affiche bien « pas de données dans la fenêtre »
   et jamais un « Kt = 0 » lisible comme « pas de tonalité ». Non vérifié.
3. **Les trois 821SE xlsx de plus de 100 Mo** n'ont pas été passés dans
   kt-recon (chargement SheetJS de plus de 25 min) : leur prise en charge
   reste non vérifiée par cette voie.
4. Relancer ces six fichiers sur une fenêtre qui recoupe la mesure (p. ex.
   `evalHour` = heure de début) pour obtenir un vrai verdict Kt.

---

## #5 — SÉCURITÉ : SheetJS `xlsx@0.18.5` vulnérable sur le chemin de LECTURE

**Statut** : **corrigé** le 2026-09-23 — SheetJS 0.20.3 vendorisé
(`vendor/xlsx-0.20.3.tgz`, procédure et provenance : `docs/sheetjs.md`).
Golden 0.18.5 → 0.20.3 sur fichiers réels : égalité stricte, un écart accepté
et documenté (convention de date d'une cellule horaire pure).

**`npm audit` ne voit plus `xlsx` — c'est ATTENDU, pas un oubli.**
Contrairement à ce qui était prévu (« restera rouge »), l'audit est MUET sur
`xlsx` après installation : une dépendance `file:` n'est pas confrontée au
registre. Il ne signale donc ni les anciens avis (corrigés en 0.20.3) ni de
futurs avis : la veille SheetJS est manuelle (`docs/sheetjs.md`). Vérifier
la version avec `node -p "require('xlsx').version"`.

**Reste ouvert** : les parseurs ECME et carrière ne sont pas couverts par le
golden (modules masqués, aucun fichier réel) — à couvrir avant démasquage.
**Sévérité** : haute (npm audit) — déclenchable par un fichier fourni par
l'utilisateur (fichier de mesure, export ECME, carrière, Lp).

### Constat

`package.json` : `"xlsx": "^0.18.5"` (installé : 0.18.5). Deux avis :

- **GHSA-4r6h-8v6p-xvw6** — pollution de prototype à la lecture d'un
  classeur forgé (corrigé en 0.19.3) ;
- **GHSA-5pgg-2g8v-p4x9** — ReDoS (corrigé en 0.20.2).

`npm audit` : « PAS DE FIX npm ». L'éditeur a quitté le registre npm ; les
versions corrigées ne sont publiées que sur `cdn.sheetjs.com`. Dernière
version disponible : **0.20.3** (`xlsx-latest` → 0.20.3 ; 0.20.4+ → 404,
vérifié le 2026-09-23).

### Points de lecture (`XLSX.read`)

| Fichier:ligne | Parseur | Thread |
|---|---|---|
| `src/modules/formatDetectors.ts:766` | `parseWorkbook` (831C/821SE) | worker si > 1 Mo (`workers/parserWorker.ts:34`), **principal** sinon (`App.tsx:165`) |
| `src/utils/ecmeParser.ts:116` | `parseEcmeFile` | **principal** (`pages/EcmePage.tsx:41`) |
| `src/utils/carriereParser.ts:217`, `:278`, `:341` | parseurs carrière | **principal** (`pages/CarrierePage.tsx`) |
| `src/utils/universalParser.ts:47` | `parseLpFile` | **principal** (`components/LwCalculator.tsx`) |
| `src/modules/parser821SE.ts:339`, `parser831C.ts:103` | `parse821SE` / `parse831C` | **code mort** : aucun appelant hors tests |

Une pollution de prototype survenue DANS le worker reste confinée à son
realm ; sur le thread principal, elle atteint toute l'application.

Écriture seule (`XLSX.writeFile`, 9 sites : exports) : non concernée par ces
deux avis. Utilitaires purs : `XLSX.SSF.parse_date_code`, `XLSX.utils.*`.

### Voies de migration (à trancher)

1. **CDN en dépendance directe** — `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`
   (méthode documentée par SheetJS). Le lockfile fige URL + intégrité.
   Risque : installation dépendante de la disponibilité du CDN et du proxy
   TLS du poste.
2. **Vendoring** — tarball 0.20.3 (2,4 Mo) versionné dans le dépôt,
   `"xlsx": "file:vendor/xlsx-0.20.3.tgz"`. Installation hors-ligne et
   reproductible ; mises à jour manuelles.
3. **Remplacement du parseur de lecture** — lecture OOXML directe (zip +
   XML) pour les formats connus. Chantier lourd (5 parseurs actifs), mais
   pourrait aussi régler la lecture intégrale en mémoire d'un classeur de
   100 Mo (> 25 min).

Quelle que soit la voie : saut 0.18 → 0.20, à valider par les tests de
parseurs ET une passe sur les fichiers réels de `.local-data/`
(`scripts/kt-recon.mjs`), la gestion des dates étant le point sensible.

---

## #6 — SÉCURITÉ : `maplibre-gl@5.23.0` — avis CRITIQUE (npm audit)

**Statut** : ouvert, non corrigé.

**GHSA-jrc7-96c5-q579** — contournement de `DOM.sanitize()` (XSS), versions
≤ 6.4.0. Installé : 5.23.0 ; dernière : 6.11.1 (**saut de version majeure**).
Usages : `src/components/meteo/MeteoMap.tsx`, `src/components/Vue3DTab.tsx`.
Exposition atténuée : tout le contenu injecté par `Popup.setHTML` passe par
`escapeHtml` (`MeteoMap.tsx:100-130`, `Vue3DTab.tsx:919`, `:1256`). Mise à
jour à faire malgré tout, avec vérification des deux cartes.

`npm audit` signale aussi, en « high » avec correctif disponible : vite,
postcss, nanoid, form-data, brace-expansion.

### Analyse de la migration 5.23 → 6.11.1 (recon du 2026-09-23, rien de mis à jour)

Toutes les ruptures sont en **6.0.0** (aucune entrée ⚠️ de 6.1 à 6.11.1 ;
CHANGELOG et guide de migration lus au tag v6.11.1).

| Rupture 6.0.0 | Affecte l'app ? | Où |
|---|---|---|
| Distribution ESM seule, **plus d'export par défaut** | **Oui — casse le build** | `import maplibregl from 'maplibre-gl'` : `MeteoMap.tsx:2`, `Vue3DTab.tsx:6` → `import * as maplibregl` |
| Worker : plus de `blob:` intégré ; sous Vite, `setWorkerUrl()` requis | **Oui — casse l'exécution** | aucun `setWorkerUrl` dans le dépôt → `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'` |
| CSP `worker-src` du player Power Apps (worker devenu fichier de même origine) | Incertain | à vérifier en Local Play puis publié |
| WebGL2 obligatoire (`GPUInitializationError`) | Incertain, faible | `MeteoMap.tsx:45`, `Vue3DTab.tsx:529` (sans try/catch) ; postes VDI |
| style-spec v25 : erreurs sur expressions héritées | Incertain, faible | filtres `['==', '$type', …]` `Vue3DTab.tsx:731-750` (conversion encore présente en 6.11.1) |
| `zoomLevelsToOverscale` = 4 par défaut | Incertain, faible | `queryRenderedFeatures` `Vue3DTab.tsx:643`, `:908` à très fort zoom |
| Lignes semi-transparentes superposées sans cumul | Visuel mineur | `MeteoMap.tsx:159`, contours de `Vue3DTab` |
| Autres (ES2022, `map.transform`, classes d'événements, `setData` sans 2ᵉ argument, GeoJSON imbriqué, Hash, lumière, icônes) | Non | API non utilisées ou usage compatible |

**Exposition réelle à GHSA-jrc7-96c5-q579 : nulle.** `DOM.sanitize` ne sert
qu'aux chaînes d'attribution des sources (`AttributionControl`) ; celles de
l'app sont des constantes (`MeteoMap.tsx:28`, `Vue3DTab.tsx:56`).
`Popup.setHTML` n'appelle jamais `sanitize` (ni en v5 ni en v6) : sa sûreté
repose sur `escapeHtml`, vérifié sur toutes les interpolations.

**Effort : faible à moyen** — deux corrections mécaniques (import, worker) ;
l'essentiel est la recette manuelle des deux cartes (marqueurs, popups,
terrain, extrusions, sélection), qu'aucun test ne couvre.

---

## #7 — Note : fins de ligne (`core.autocrlf`)

**Statut** : information, aucune action requise.

`core.autocrlf = true` est réglé au niveau **système**
(`C:/Program Files/Git/etc/gitconfig`), pas dans le dépôt. Le dépôt porte
déjà un `.gitattributes` avec `* text=auto` : l'index est normalisé en LF
quel que soit le réglage du poste, donc aucun diff fantôme de fins de ligne
dans les commits. Seules les copies de travail peuvent alterner CRLF/LF
selon l'outil qui écrit le fichier ; c'est sans effet sur l'historique.

---

## #8 — `parseEcmeFile` accepte n'importe quel classeur, en silence

**Statut** : ouvert, non corrigé.
**Sévérité** : moyenne — résultat faux sans message d'erreur.

### Constat

Passé à `parseEcmeFile`, un export 831C (feuille 1 « Sommaire », au format
libellé / valeur) est accepté et produit **107 « occupations »** : chaque
libellé devient une `refBv`, chaque valeur un `modele` — dont des durées
(« Durée », « Pause ») converties en date de 1899.

La lecture POSITIONNELLE (`src/utils/ecmeParser.ts:155` col A → `refBv`,
`:157` col B → `modele`) est conforme au format ECME documenté
(`:6-8`) : ce n'est pas un décalage de colonnes. Le défaut est l'absence de
validation du format :

- `:135-142` — si aucune des 8 premières lignes n'a une date en colonne E,
  `headerRow` reste à 0 **sans erreur** ;
- `:145-149` — aucune colonne de date détectée : non vérifié, le parseur
  continue ;
- aucune vérification des libellés d'en-tête (Réf. BV, Modèle…).

### Piste

Refuser explicitement (« ce fichier n'est pas un classeur ECME ») quand
aucune ligne d'en-tête datée n'est trouvée ou que `dateColumns` est vide.

Découvert lors du golden SheetJS (831C passé à tous les parseurs).

### PRÉALABLE au démasquage du module Parc ECME

Le correctif de validation est un **préalable** à tout passage de
`FEATURES.parcEcme` à `true` (`src/config/features.ts:18`). Un parseur
qui accepte un 831C et renvoie 107 occupations sans rien dire, c'est un refus
silencieux. Pas de correctif tant que le module est masqué.

Autres préalables au démasquage, relevés au passage :

- le rendu de `EcmePage` n'est PAS gardé par le flag
  (`src/App.tsx:2248`, `effectiveTab === 'ecme'` seul), contrairement à
  Carrière (`src/App.tsx:2228`, `FEATURES.carriere && …`). Il est
  inatteignable aujourd'hui uniquement parce qu'aucun chemin de navigation ne
  met `activeTab` à `'ecme'` (barre filtrée par `SUBTABS`, `:1800`) ;
- le golden SheetJS ne couvre pas `parseEcmeFile` sur un vrai classeur ECME
  (`docs/sheetjs.md`, « Couverture »).

---

## G4 — Export Excel sans styles (SheetJS npm n'écrit pas de styles)

**Statut** : **fermé** le 2026-09-23.

L'export Excel du module Météo est désormais écrit avec **ExcelJS 4.4.0**
(MIT), chargé à la demande (`import()` dynamique : chunk séparé de
~256 Ko gzip, hors bundle principal). SheetJS reste la bibliothèque de
**lecture**. Module : `src/utils/meteoExcel.ts` ; onglets Synthèse §3.6,
un par source (format proche de l'Annexe A), Comparaison, Métadonnées ;
verdict coloré par niveau (recevable / à signaler / non recevable /
indéterminé), en-têtes sarcelle, point de rosée calculé signalé par une
note de cellule. Vérifié : relecture ExcelJS et SheetJS (tests), ouverture
dans Excel 16 de bureau sans journal de réparation.

Choix : xlsx-js-style écarté (dernière publication 2022, embarque SheetJS
0.18.5 vulnérable, +338 Ko gzip) ; SpreadsheetML 2003 écarté (non ouvert
par Excel Online, Teams/SharePoint, mobile) ; OOXML écrit à la main écarté
(temps de validation multi-environnements non justifié par l'écart de poids).

Hors périmètre, restés en SheetJS sans styles : les 8 autres exports
(`grep -rn "XLSX.writeFile" src`). `npm audit` : ExcelJS remonte en
« moderate » via `uuid@8.3.2` (GHSA-w5hq-g745-h8pq, vérification de bornes
quand l'appelant fournit un tampon `buf`) — version déjà présente dans
l'arbre via `@microsoft/power-apps`.

---

## #9 — Un projet sauvegardé par une version PLUS RÉCENTE de l'app perd ses données en silence

**Statut** : ouvert, non corrigé (hors MVP G3, décision du 2026-09-23).
**Sévérité** : moyenne — perte de données silencieuse, sans message.

### Constat

Depuis G3, le blob Dataverse est en `SCHEMA_VERSION = 2`
(`src/modules/dataverseProjectStore.ts`) et l'export fichier en
`PROJECT_VERSION = '1.2'` (`src/modules/projectManager.ts`) : le module
météo y porte ses `results` figés.

Aucune voie de chargement ne compare la version lue à celle de l'app :
`deserializeProject` renvoie `schemaVersion`, mais
`handleOpenDataverseProject` n'en garde que `{ project }` (`src/App.tsx`),
et `loadProject` vérifie seulement la PRÉSENCE de `version`.

Conséquence : une version antérieure de l'app (poste non à jour, cache du
player) qui ouvre un blob v2 ignore les champs qu'elle ne connaît pas —
dont les résultats météo figés — puis, à la sauvegarde suivante, **réécrit le
blob sans eux**. Les données figées sont perdues sans avertissement.

### Piste

Au chargement, si `schemaVersion > SCHEMA_VERSION` (ou `version` >
`PROJECT_VERSION`) : avertissement non bloquant (« projet enregistré par une
version plus récente d'AcoustiQ — l'enregistrer ici peut perdre des
données ») et, au minimum, confirmation avant d'écraser le blob.
