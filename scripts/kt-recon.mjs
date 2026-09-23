#!/usr/bin/env node
/**
 * Reconnaissance Kt sur fichiers de mesure RÉELS, non versionnés.
 *
 *     node scripts/kt-recon.mjs
 *
 * Lit chaque `.csv` / `.xlsx` déposé dans `.local-data/` (gitignoré), le parse
 * par le chemin EXACT de l'application (`parseWorkbook` / `parseCsv`), applique
 * la fenêtre d'évaluation que l'UI transmet réellement à `analyzeKt` à
 * l'ouverture d'un fichier — [14:00, 15:00[, cf. Conformite2026.tsx:169,
 * :234-235, :240-246 — puis affiche, pour chaque fichier :
 *
 *   · le spectre LZeq moyen BRUT, tel que parsé ;
 *   · le même spectre réaligné PAR FRÉQUENCE sur les 24 bandes d'analyse ;
 *   · le Kt obtenu, la bande tonale et les niveaux de ses deux voisines ;
 *   · le verdict de `analyzeKt` de `main` sur exactement la même entrée.
 *
 * Aucune dépendance de dev : Node exécute les `.ts` nativement (type stripping,
 * Node ≥ 22.18), et `kt-recon.loader.mjs` comble les deux écarts avec le
 * résolveur de Vite. Le `register` n'agit que sur les imports qui le SUIVENT :
 * d'où la séparation entre cette amorce et `kt-recon.body.mjs`.
 */
import { register } from 'node:module'

register('./kt-recon.loader.mjs', import.meta.url)

const { main } = await import('./kt-recon.body.mjs')
await main()
