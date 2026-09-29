# Chantier #19 — relevés de plus de 24 h : temps absolu non replié

Suivi du chantier de correction de #19 (`docs/issues.md`). Il ferme aussi #15
(fenêtre à cheval sur minuit) et #20 (axe multi-jours indexé par rang de date).

## Décisions (2026-09-28)

**Option A retenue** — un `MeasurementFile` par relevé source, `t` NON replié
(minutes d'heure murale depuis minuit de la date du fichier, peut dépasser 1440).
Rejeté : B (un fichier par date civile). Motif : une nuit réglementaire traverse
minuit par définition ; B fait de minuit un mur et laisse #15 ouvert au premier
relevé de nuit continue ; A le supprime (le temps absolu n'a pas de frontière à
minuit). La dispersion (≈ 25 consommateurs) est un argument de coût, pas de
justesse — et un argument pour le faire maintenant.

- **A1 — heure d'été** : conversion par date et heure MURALES
  (`new Date(a, m, j, 0, t)`), plus « minuit + t × 60 000 ». Un sonomètre
  horodate en heure murale : une mesure à 3 h le jour du changement est à 3 h.
  Corollaire : « identique au bit près » ne vaut que pour les fichiers d'un seul
  jour SANS changement d'heure ; sur un relevé qui le traverse, le golden DOIT
  différer — écrit comme comportement attendu, avec sa justification.
- **A2 — rattachement des nuits** : la nuit du 3 juillet va du 3 à **19 h** au 4
  à 7 h, dans les DEUX cadres (§2.2 des lignes directrices, partie 1 de la note
  98-01) ; le 22 h vient du positionnement du microphone (98-01), pas de la
  définition des périodes. Indices ET Conformité alignés sur 19 h – 7 h. Lnuit
  change de valeur sur tous les projets, y compris d'un seul jour : signalement
  au chargement disant que la valeur change et pourquoi.
- **A3** — le lot 19.5 ferme #20 (test sur dates non consécutives) : deux
  chantiers qui réécrivent le même code sont un conflit garanti.

Conditions : golden des parseurs AVANT (lot 19.0) ; les cinq tests qui
verrouillent le repli revus un par un avec justification écrite (ci-dessous) ;
exclusions existantes détectées et signalées au chargement, jamais corrigées en
silence ; lots mergés séparément ; #15 fermée par ce chantier, vérifiée
explicitement (lot 19.2).

### La période « soir » — un héritage, pas un cadre réglementaire (à traiter au lot 19.3)

Rappel (2026-09-29) : le cadre 2026 ne connaît que jour (7 h – 19 h) et nuit
(19 h – 7 h) ; il n'y a pas de période « soir » au §2.2. Les PDF embarqués
(`public/reglementation/`, scans sans couche texte, lus page par page) le
confirment : lignes directrices 2026 §2.2 et Tableau 1, note 98-01 partie 1 —
jour 7 h – 19 h, nuit 19 h – 7 h, aucun soir.

Origine dans AcoustiQ (auteur du dépôt, sans source citée) :
- `7621d83` (2026-04-08, « refonte UX ») : première apparition,
  `lsoir: laeqOnPeriod(data, 19, 22)` et une aide qui attribue à tort
  « Soir 19h–22h, Nuit 22h–07h » aux lignes directrices 2026 ;
- `057fa15` (2026-06-18) : affirme des bornes « 07-19 / 19-22 / 22-07 communes
  Note 98-01 (EQ-09) et MELCCFP 2026 », sans citation. « EQ-09 » renvoie à un
  formulaire interne absent du dépôt (`find . -path ./node_modules -prune -o
  -iname "*EQ-09*" -print` → vide) : source invérifiable ;
- `8180768` (2026-07-20) : crée `REG_PERIODS` et propage le soir au module
  Météo, par COHÉRENCE INTERNE (« AcoustiQ calcule déjà Ljour/Lsoir/Lnuit »),
  pas par un texte. Le même commit laisse volontairement
  `Conformite2026.periodOf` binaire (seule partie conforme aujourd'hui).

Statut : héritage à documenter comme tel au lot 19.3. Commentaires et libellés
qui l'attribuent à tort au cadre : `acoustics.ts:311, 341-342`,
`IndicesPanel.tsx:55-60, 826`, `recevabilite.ts:12, 59, 179`, `CLAUDE.md`.
Consommateurs : `REG_PERIODS` / `regPeriodOfHour` (`acoustics.ts:321-337`),
`regPeriod.ts`, `indicesWindow.ts` (mode `soir`), `IndicesPanel.tsx` (38-48,
163-192, 556 — les boutons de période recalculent aussi Kt et les correctifs
98-01 —, 826-850, export Excel 291-292 et 332-348), Météo (`recevabilite.ts`
176-185, 464, 490-534 ; `SourceTable.tsx` 34-48, 96, 168 ;
`MeteoInspector.tsx` 22, 54 — étiquettes seulement), module Carrière (bornes
éditables, défaut 19-22). **Non persisté** : `IndicesSnapshot`
(`types/index.ts:288-295`) ne porte que laeq/l10/l50/l90/lafmax/lafmin ; le
soir ne sort de l'app que par l'export Excel d'`IndicesPanel`. (Corrige une
affirmation antérieure de ce document.)

## Principe d'ordonnancement

Consommateurs d'abord, bascule du parseur EN DERNIER (lot 19.6) : chaque lot
rend ses consommateurs justes en temps absolu (testés sur données dépliées
synthétiques) ET identiques au bit près sur les données d'un seul jour sans
changement d'heure. Main reste livrable à chaque merge ; un fichier replié n'est
jamais traité plus mal qu'aujourd'hui. Limite : avant 19.6, le multi-jours n'est
vérifiable que par les tests.

Chaque lot : golden AVANT sur le main du moment (familles « un jour » —
identique — et « plusieurs jours » — tableau des changements attendus),
contrôle par mutation, merge, suppression de la branche partout.

## Lots

| Lot | Contenu | Ferme |
|---|---|---|
| 19.0 | golden des parseurs > 24 h (synthétique versionné + local réel), contrôle par mutation, revue écrite des cinq tests | — |
| 19.1 | `src/utils/tempsMesure.ts` : instant absolu (heure murale, A1), date civile / minute du jour, fenêtre absolue, dates couvertes par un fichier, clé entière à la seconde | — |
| 19.2 | Conformité : fenêtre Ba et couverture en temps absolu (`conformiteFenetre.ts:146-158`, `:~401-419`), fichiers couvrant la date (`:108-133`), Br période calme (`Conformite2026.tsx:141-152`), nuit 19–7 | **#15** |
| 19.3 | Indices, 98-01, rapport : `leqOnRegPeriod`, `leqByClockHour`, `dayEnergyDistribution`, `regPeriod`, `indicesWindow`, 11 filtres `IndicesPanel`, L90 horaire ambiant, feuille brute Excel, `corr9801`, `reportIndices`, `buildIndicesSnapshot` ; nuit 19–7 (A2) | — |
| 19.4 | Événements, annotations, émergences, audio, `sessionDetection` | — |
| 19.5 | Courbe, spectrogramme, spectre instantané, carte, `availableDates`, dates du rapport | **#20** |
| 19.6 | Bascule du parseur (`serialDaysToMin`, date data-first), migration Dataverse SCHEMA 4 (dépliage), JSON 1.4, signalements (exclusions existantes, Lnuit), golden 19.0 mis à jour cas par cas | **#19** |

## Lot 19.1 — `src/utils/tempsMesure.ts` (2026-09-29)

Module pur, **sans consommateur** : aucun comportement de l'app ne change. Les
lots 19.2 à 19.5 y basculent le code qui recalcule « minuit + t × 60 000 » à
la main (`dpTimestampMs`, `exclusionMeteo.ts:191-198`, `conformiteFenetre.ts:410`,
`App.tsx:1570`, `TimeSeriesChart.tsx:978, 2607`, `InstantSpectrum.tsx:195`,
`Spectrogram.tsx:917`).

| Fonction | Rôle |
|---|---|
| `instantMs(date, t)` | instant absolu en heure murale (A1) ; NaN si illisible |
| `statutMural` / `heureAmbigue` | `normal` / `ambigu` (heure répétée) / `inexistant` (heure sautée) ; `null` si illisible |
| `dateEtMinute` | date civile + minute du jour, calendrier pur |
| `decalageJours` / `tDansRepere` | alignement de deux repères par la date (jamais par rang) |
| `fenetreAbsolue` / `dansFenetre` | fenêtre [début, fin[, fin ≤ début ⇒ lendemain |
| `datesCouvertes` | dates touchées + t illisibles COMPTÉS |
| `cleSeconde` | clé entière à la seconde, murale, indépendante du fuseau |

- **Identique au bit près** à `dpTimestampMs` sur chaque échantillon des cinq
  relevés de juillet du golden 19.0 (t replié ET déplié, gigue comprise).
- **Différent, comme attendu (A1)** : passage à l'heure d'été, −1 h exactement
  dès 03:00 le 8 mars 2026 ; retour à l'heure normale, +1 h exactement dès 02:00
  le 2 nov. 2025. `instantMs` = `new Date(a, m, j, 0, 0, 0, ms)` vérifié minute
  par minute (et toutes les 37 s) sur 4 jours autour de chaque changement.
- **Heure répétée** (décision A du 2026-09-29) : les 60 minutes 01:xx du relevé
  du 2 nov. 2025 donnent 120 échantillons `heureAmbigue` et 60 `cleSeconde`
  partagées chacune par deux mesures DISTINCTES. Fait de donnée légitime :
  signalé, jamais fusionné, jamais refusé en silence. #14 doit en tenir compte
  (une clé partagée dans l'heure ambiguë n'est ni un doublon ni un recouvrement).
  `instantMs` y rend la première occurrence (comme `new Date`), ce qui confond
  les deux passages : un consommateur qui a besoin de l'ordre doit s'appuyer sur
  l'ordre du fichier et sur `heureAmbigue`, pas sur l'instant seul.
- **Gigue du flottant** : le statut est tranché à la SECONDE de l'horodatage.
  Sur `t` brut, 02:00 lu « 01:59:59,9999998 » tombait dans l'heure répétée et
  était placé une heure trop tôt ; 01:00 lu « 00:59:59,9999998 » n'était pas vu
  ambigu (118 au lieu de 120). Test dédié.
- **Fuseau des tests figé** : `process.env.TZ = 'America/Toronto'` dans
  `vitest.config.ts` (décision B du 2026-09-29).
- **Mutation** (`node scripts/temps-mesure/mutations.mjs`) : 13/13 tuées
  (repli modulo 1440 de l'instant et de la date, correction d'heure d'été
  retirée, 2e occurrence de l'heure répétée, décalage d'après dans l'heure
  sautée, statut sur `t` brut, ambigu non signalé, décalage de jours en heure
  locale, fenêtre fermée à droite, début = fin vide, dates impossibles
  acceptées, t illisibles non comptés, clé tronquée).

## Revue des cinq tests qui verrouillent le repli

Aucun n'est modifié au lot 19.0 (le comportement ne change pas encore). Pour
chacun : ce qu'il affirme, pourquoi il verrouille le repli, le comportement
attendu après correction et sa justification, et le lot qui le change.

### 1. `src/utils/regPeriod.test.ts:45-50` — « continuité 23h→01h (t normalisé mod 1440) »

- **Affirme** : pour l'entrée `[23:00, 23:59, 0, 1, 01:00]` (t revenu à 0 après
  minuit), `dataInRegPeriod(…, 'nuit')` renvoie `[0, 1, 60, 1380, 1439]` et
  `coveredMin = 5`.
- **Verrouille le repli** : l'entrée EST le contrat du parseur replié (un
  relevé de deux jours dont `t` repart à 0). La sortie triée par valeur de `t`
  place 00:00 avant 23:00 : l'ordre chronologique est perdu.
- **Attendu après** : entrée non repliée `[1380, 1439, 1440, 1441, 1500]` ; les
  cinq échantillons sont dans la nuit du 3 (19 h le 3 → 7 h le 4, A2), rendus
  dans l'ordre chronologique, `coveredMin = 5`.
- **Justification** : le parseur ne replie plus (#19) ; la nuit est une période
  continue rattachée au jour où elle commence (A2).
- **Lot** : 19.3. NB : le test voisin `:40-43` (« seuls les points après 22h »)
  change aussi, par A2 (borne 19 h) — pas par le repli.

### 2. `src/utils/exclusionMeteo.test.ts:199-200` — `plagesMesureDepuisFichiers`, « passage de minuit »

- **Affirme** : `data: [1430, 1435, 0, 5, 60]` sur le 3 juillet donne les plages
  23:50 → 00:06 le 4, puis 01:00 → 01:01 le 4 (la chute de plus de 12 h est lue
  comme un passage de minuit).
- **Verrouille le repli** : la fonction contourne le défaut de #19 en
  détectant les chutes de `t` (`exclusionMeteo.ts:196`).
- **Attendu après** : le cas replié est CONSERVÉ (compatibilité : il décrit un
  ancien blob avant migration) ; un cas non replié `[1430, 1435, 1440, 1445, 1500]`
  est ajouté et doit donner EXACTEMENT les mêmes plages.
- **Justification** : après la migration au chargement (19.6), aucune donnée
  repliée n'atteint plus la fonction ; la détection de chute devient redondante
  mais reste inoffensive, et le test prouve que les deux représentations
  donnent les mêmes plages.
- **Lot** : 19.6.

### 3. `src/utils/laftm5Oracle.test.ts:24` — `secOfDay` de l'oracle LAFTM5

- **Affirme** : l'oracle regroupe par heure les échantillons du fichier réel
  831C (07:00 → ~14:48, un seul jour) avec `secOfDay` = fraction du jour.
- **Verrouille le repli** : non pas le code de l'app, mais la clé de
  l'oracle, qui confondrait deux jours sur un fichier de plus de 24 h.
- **Attendu après** : clé horaire ABSOLUE (`floor(sériel × 24)`) ; résultat
  identique sur ce fichier d'un seul jour.
- **Justification** : l'oracle doit rester valide si on lui donne un relevé
  multi-jours ; le changement est neutre sur le fichier actuel. NB : le test ne
  s'exécute que si le fichier existe à son chemin OneDrive (`skipIf`), qui n'est
  pas la copie de `.local-data/`.
- **Lot** : 19.3 (98-01).

### 4. `src/utils/indicesWindow.test.ts:61-64` — « nuit : franchit minuit »

- **Affirme** : sur un échantillon d'une seule date, `windowData(…, 'nuit')`
  retient `[00:00, 06:59, 22:00, 23:30]` — le matin ET le soir de la même date
  civile.
- **Verrouille le repli** : c'est la convention « nuit par date civile », qui
  n'a de sens que si `t` est replié ; elle MÉLANGE la fin d'une nuit (celle du
  2 au 3) et le début d'une autre (celle du 3 au 4).
- **Attendu après** : nuit du 3 = [19:00 le 3, 07:00 le 4[ ; sur un échantillon
  du seul 3 juillet, elle ne retient que 22:00 et 23:30 (et tout point entre
  19 h et 22 h) ; 00:00 et 06:59 appartiennent à la nuit du 2.
- **Justification** : A2 (nuit continue, 19 h – 7 h, rattachée au jour où elle
  commence) et temps non replié (A).
- **Lot** : 19.3.

### 5. `src/utils/acoustics.test.ts:381-387` — `leqOnRegPeriod`, « gère le passage minuit (nuit 22-07) »

- **Affirme** : `[23:00 → 45 dB, 02:00 → 45 dB]` de la même date : nuit
  22–7 = 45 dB, `coveredMin = 2`, `periodMin = 540`.
- **Verrouille le repli** : 02:00 et 23:00 de la même date sont comptés dans
  la MÊME nuit — possible seulement si l'on raisonne en minutes modulo 1440.
- **Attendu après** : nuit du jour (19 h – 7 h) : seul 23:00 y tombe (02:00 est
  dans la nuit précédente) ⇒ `leq = 45`, `coveredMin = 1`, `periodMin = 720`.
- **Justification** : A2 (bornes 19 h – 7 h, nuit rattachée au jour où elle
  commence) et temps absolu (A).
- **Lot** : 19.3. NB : le test voisin `:374-379` (période soir 19–22) dépend du
  point ouvert « soir » ci-dessus.
