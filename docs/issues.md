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
   - `src/utils/spectraProvenance.ts:56` —
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

`readMeta` (`formatDetectors.ts:171-196`) lit le Sommaire à des lignes FIXES
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
vrai, donc `isTonal` est **faux par construction** (`acoustics.ts:842-850`).

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
   (`bande-analyse-absente`, `ktLevelsByFrequency`, `acoustics.ts:771-774`).

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
(`acoustics.ts:605-623`) présente l'élargissement comme un compromis entre
couverture et calculabilité : **ce compromis n'existe pas** dès lors que les
deux rôles sont séparés. Cette entrée remplace cette lecture.

### Ce qui reste à trancher

Non pas la faisabilité, mais la **méthode réglementaire** : les Lignes
directrices MELCCFP 2026 (§3.7.4, Tableau 2) fixent des seuils par bande, et il
faut confirmer avec un acousticien que l'analyse tonale s'étend légitimement
au-delà de 10 kHz — et, si oui, jusqu'où. La réponse décide si l'élargissement
est une correction de calcul ou un changement de méthode. Le sort de 50 Hz se
tranche dans le même mouvement.
