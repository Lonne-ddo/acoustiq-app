/**
 * Base de données de parois pour le module Isolement acoustique.
 *
 * Chaque paroi porte son indice global Rw + les termes C (bruit rose) et
 * Ctr (bruit trafic) selon ISO 717-1, et son indice d'affaiblissement
 * acoustique R(f) en bandes de tiers d'octave (100 Hz – 5 kHz).
 *
 * Les spectres sont dérivés de profils normalisés par type de matériau
 * (mass-law pour la maçonnerie, dip de résonance + coïncidence pour les
 * cloisons légères et les vitrages) puis recentrés sur le Rw déclaré.
 * Les valeurs sont indicatives — saisir un spectre mesuré si disponible.
 */

/** Fréquences centrales 1/3 d'octave utilisées par le module (100 Hz – 5 kHz). */
export const WALL_BANDS = [
  100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
] as const

export type WallCategory = 'maçonnerie' | 'cloison' | 'vitrage' | 'porte' | 'toiture' | 'plancher'

export interface Wall {
  id: string
  category: WallCategory
  name: string
  description: string
  thickness_mm: number
  Rw: number
  C: number
  Ctr: number
  R_by_band: Record<string, number>
}

// ── Profils spectraux normalisés ────────────────────────────────────────────
// Offsets (dB) à ajouter à Rw pour obtenir R(f). 18 valeurs : 100 Hz → 5 kHz.
// Calibrés pour que R(500) = Rw et que la courbe suive l'allure physique du
// matériau (mass-law vs résonances).

const SHAPE_CONCRETE = [-9, -7, -5, -3, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
const SHAPE_MASONRY =  [-10, -8, -6, -4, -2, 0, 1, 2, 3, 3, 4, 5, 6, 7, 7, 8, 8, 9] as const
// Cloison légère : dip résonance masse-ressort-masse autour de 100 Hz + dip
// coïncidence autour de 2 kHz (BA13).
const SHAPE_STUD =     [-14, -12, -10, -6, -3, -1, 0, 1, 2, 3, 4, 3, 2, 0, 1, 3, 5, 6] as const
const SHAPE_STUD_DBL = [-12, -10, -8, -5, -2, 0, 1, 2, 3, 4, 5, 5, 4, 2, 3, 5, 7, 8] as const
// Verre simple : dip de coïncidence marqué vers 2 kHz pour 4 mm.
const SHAPE_GLASS_S =  [-10, -8, -6, -4, -2, 0, 1, 2, 3, 4, 4, 3, 1, -3, 0, 3, 5, 6] as const
// Double vitrage : résonance masse-air-masse ~200 Hz + coïncidence ~2 kHz.
const SHAPE_GLASS_D =  [-12, -10, -8, -6, -3, 0, 1, 2, 3, 4, 5, 5, 3, -1, 1, 3, 5, 6] as const
const SHAPE_GLASS_LAM =[-10, -7, -4, -2, 0, 1, 2, 3, 4, 5, 6, 6, 5, 2, 3, 5, 7, 8] as const
const SHAPE_GLASS_T =  [-13, -11, -9, -7, -4, -1, 0, 1, 2, 3, 5, 6, 5, 2, 2, 4, 6, 7] as const
const SHAPE_DOOR =     [-10, -8, -6, -4, -2, 0, 1, 2, 3, 3, 4, 3, 2, 0, 1, 2, 3, 4] as const
const SHAPE_DOOR_METAL=[-9, -7, -5, -3, -1, 0, 1, 2, 3, 4, 4, 3, 2, 0, 0, 2, 4, 5] as const
const SHAPE_FLOOR_LIGHT=[-13, -11, -9, -5, -2, -1, 0, 1, 2, 3, 3, 2, 1, 0, 1, 2, 4, 5] as const

function spectrum(rw: number, shape: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < WALL_BANDS.length; i++) {
    out[String(WALL_BANDS[i])] = rw + shape[i]
  }
  return out
}

// ── Catalogue des parois ────────────────────────────────────────────────────

export const WALL_DATABASE: Wall[] = [
  // MAÇONNERIE -------------------------------------------------------------
  {
    id: 'beton-plein-200',
    category: 'maçonnerie',
    name: 'Béton plein 200 mm',
    description: 'Béton armé coulé, 2400 kg/m³, sans doublage.',
    thickness_mm: 200,
    Rw: 58, C: -1, Ctr: -5,
    R_by_band: spectrum(58, SHAPE_CONCRETE),
  },
  {
    id: 'beton-plein-150',
    category: 'maçonnerie',
    name: 'Béton plein 150 mm',
    description: 'Béton armé 150 mm, sans doublage.',
    thickness_mm: 150,
    Rw: 53, C: -1, Ctr: -4,
    R_by_band: spectrum(53, SHAPE_CONCRETE),
  },
  {
    id: 'beton-cellulaire-200',
    category: 'maçonnerie',
    name: 'Béton cellulaire 200 mm',
    description: 'Bloc cellulaire 500 kg/m³, monté au mortier-colle.',
    thickness_mm: 200,
    Rw: 46, C: -1, Ctr: -4,
    R_by_band: spectrum(46, SHAPE_MASONRY),
  },
  {
    id: 'brique-creuse-200',
    category: 'maçonnerie',
    name: 'Brique creuse 200 mm',
    description: 'Brique terre cuite creuse, joints minces.',
    thickness_mm: 200,
    Rw: 45, C: -1, Ctr: -3,
    R_by_band: spectrum(45, SHAPE_MASONRY),
  },
  {
    id: 'parpaing-200',
    category: 'maçonnerie',
    name: 'Parpaing 200 mm',
    description: 'Bloc béton creux standard, joints mortier.',
    thickness_mm: 200,
    Rw: 48, C: -1, Ctr: -4,
    R_by_band: spectrum(48, SHAPE_MASONRY),
  },

  // CLOISONS LÉGÈRES -------------------------------------------------------
  {
    id: 'cloison-ba13-simple',
    category: 'cloison',
    name: 'Placo BA13 simple sur ossature 48 mm (laine)',
    description: '1 BA13 + ossature 48 mm + laine minérale 45 mm + 1 BA13.',
    thickness_mm: 74,
    Rw: 42, C: -3, Ctr: -8,
    R_by_band: spectrum(42, SHAPE_STUD),
  },
  {
    id: 'cloison-ba13-double-70',
    category: 'cloison',
    name: 'Placo BA13 double face sur ossature 70 mm (laine)',
    description: '2 BA13 + ossature 70 mm + laine minérale 60 mm + 2 BA13.',
    thickness_mm: 122,
    Rw: 48, C: -3, Ctr: -9,
    R_by_band: spectrum(48, SHAPE_STUD),
  },
  {
    id: 'cloison-ba13-double-98',
    category: 'cloison',
    name: 'Placo BA13 double ossature 98 mm (laine)',
    description: '2 BA13 + 2 ossatures 48 mm désolidarisées + laine 90 mm + 2 BA13.',
    thickness_mm: 150,
    Rw: 58, C: -4, Ctr: -12,
    R_by_band: spectrum(58, SHAPE_STUD_DBL),
  },

  // VITRAGES ---------------------------------------------------------------
  {
    id: 'vitrage-simple-4',
    category: 'vitrage',
    name: 'Simple vitrage 4 mm',
    description: 'Verre trempé ou clair 4 mm.',
    thickness_mm: 4,
    Rw: 29, C: -1, Ctr: -2,
    R_by_band: spectrum(29, SHAPE_GLASS_S),
  },
  {
    id: 'vitrage-double-4-16-4',
    category: 'vitrage',
    name: 'Double vitrage 4/16/4',
    description: 'Double vitrage symétrique, lame d\'air 16 mm.',
    thickness_mm: 24,
    Rw: 30, C: -1, Ctr: -5,
    R_by_band: spectrum(30, SHAPE_GLASS_D),
  },
  {
    id: 'vitrage-double-6-16-4',
    category: 'vitrage',
    name: 'Double vitrage 6/16/4',
    description: 'Double vitrage asymétrique, lame d\'air 16 mm.',
    thickness_mm: 26,
    Rw: 33, C: -2, Ctr: -6,
    R_by_band: spectrum(33, SHAPE_GLASS_D),
  },
  {
    id: 'vitrage-double-10-16-4',
    category: 'vitrage',
    name: 'Double vitrage 10/16/4',
    description: 'Double vitrage fortement asymétrique.',
    thickness_mm: 30,
    Rw: 36, C: -2, Ctr: -7,
    R_by_band: spectrum(36, SHAPE_GLASS_D),
  },
  {
    id: 'vitrage-feuillete-442',
    category: 'vitrage',
    name: 'Feuilleté acoustique 44.2 Silence',
    description: 'Verre feuilleté 4+4 mm avec PVB acoustique.',
    thickness_mm: 9,
    Rw: 38, C: -1, Ctr: -4,
    R_by_band: spectrum(38, SHAPE_GLASS_LAM),
  },
  {
    id: 'vitrage-triple-4-12-4-12-4',
    category: 'vitrage',
    name: 'Triple vitrage 4/12/4/12/4',
    description: 'Triple vitrage, deux lames d\'air de 12 mm.',
    thickness_mm: 36,
    Rw: 34, C: -2, Ctr: -6,
    R_by_band: spectrum(34, SHAPE_GLASS_T),
  },

  // PORTES -----------------------------------------------------------------
  {
    id: 'porte-bois-40',
    category: 'porte',
    name: 'Porte bois standard 40 mm',
    description: 'Porte intérieure bois plein, joints non acoustiques.',
    thickness_mm: 40,
    Rw: 25, C: -1, Ctr: -2,
    R_by_band: spectrum(25, SHAPE_DOOR),
  },
  {
    id: 'porte-iso-40',
    category: 'porte',
    name: 'Porte isophonique 40 dB',
    description: 'Porte acoustique, joints périphériques + plinthe automatique.',
    thickness_mm: 55,
    Rw: 40, C: -2, Ctr: -5,
    R_by_band: spectrum(40, SHAPE_DOOR),
  },
  {
    id: 'porte-iso-45',
    category: 'porte',
    name: 'Porte isophonique 45 dB',
    description: 'Porte acoustique renforcée, joints + seuil guillotine.',
    thickness_mm: 65,
    Rw: 45, C: -2, Ctr: -6,
    R_by_band: spectrum(45, SHAPE_DOOR),
  },
  {
    id: 'porte-metal-pleine',
    category: 'porte',
    name: 'Porte métallique pleine',
    description: 'Vantail acier rempli, cadre métallique.',
    thickness_mm: 50,
    Rw: 32, C: -1, Ctr: -3,
    R_by_band: spectrum(32, SHAPE_DOOR_METAL),
  },

  // TOITURES / PLANCHERS ---------------------------------------------------
  {
    id: 'dalle-beton-200',
    category: 'plancher',
    name: 'Dalle béton 200 mm',
    description: 'Dalle pleine béton armé, sans chape.',
    thickness_mm: 200,
    Rw: 58, C: -1, Ctr: -5,
    R_by_band: spectrum(58, SHAPE_CONCRETE),
  },
  {
    id: 'plancher-bois-standard',
    category: 'plancher',
    name: 'Plancher bois standard',
    description: 'Solives + panneaux OSB 22 mm + plafond BA13.',
    thickness_mm: 250,
    Rw: 35, C: -2, Ctr: -6,
    R_by_band: spectrum(35, SHAPE_FLOOR_LIGHT),
  },
  {
    id: 'plancher-bois-chape-flottante',
    category: 'plancher',
    name: 'Plancher bois + isolation + chape flottante',
    description: 'Solives + OSB + laine 100 mm + chape anhydrite 50 mm sur résilient.',
    thickness_mm: 320,
    Rw: 55, C: -2, Ctr: -7,
    R_by_band: spectrum(55, SHAPE_STUD_DBL),
  },
  {
    id: 'toiture-tuile-standard',
    category: 'toiture',
    name: 'Toiture tuile + laine 200 + BA13',
    description: 'Combles aménagés : tuile + sous-toiture + laine 200 mm + BA13.',
    thickness_mm: 240,
    Rw: 43, C: -2, Ctr: -7,
    R_by_band: spectrum(43, SHAPE_STUD),
  },
]

/** Index pratique par catégorie pour l'affichage des dropdowns. */
export const WALLS_BY_CATEGORY: Record<WallCategory, Wall[]> = (() => {
  const cats: WallCategory[] = ['maçonnerie', 'cloison', 'vitrage', 'porte', 'toiture', 'plancher']
  const out = Object.fromEntries(cats.map((c) => [c, [] as Wall[]])) as Record<WallCategory, Wall[]>
  for (const w of WALL_DATABASE) out[w.category].push(w)
  return out
})()

export function findWall(id: string): Wall | undefined {
  return WALL_DATABASE.find((w) => w.id === id)
}
