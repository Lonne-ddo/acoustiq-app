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

### Point ouvert — la période « soir » (à trancher avant le lot 19.3)

Le code porte aujourd'hui trois périodes : `REG_PERIODS` (`src/utils/acoustics.ts:321-325`)
= jour 7–19, **soir 19–22**, nuit 22–7, commenté comme « MELCCFP 2026 = Note
98-01 » et « source unique ». A2 fixe la nuit à 19 h – 7 h : le soir disparaît-il
(Ljour / Lnuit seulement), ou reste-t-il une sous-période informative incluse
dans la nuit ? Les textes embarqués (`src/modules/regulation*.ts`) ne contiennent
pas la définition des périodes : la décision ne peut pas être vérifiée depuis le
dépôt. Consommateurs de `soir` : `IndicesPanel.tsx` (38-45, 172, 189, 556),
`regPeriod.ts` / `indicesWindow.ts` (mode `soir`), module Météo
(`MeteoInspector.tsx:54` via `regPeriodOfHour`, `SourceTable.tsx:34-46, 168`),
instantané persisté `IndicesSnapshot` (`ljour` / `lsoir` / `lnuit`, export JSON).

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
