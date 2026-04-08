/**
 * Mapping des 521 classes YAMNet vers 7 grandes catégories d'AcoustiQ.
 * Plages d'index fixées par l'équipe (cohérentes avec l'analyse Colab
 * historique). Toute classe en dehors → catégorie "Autre".
 */

export type AudioCategory =
  | 'Humain / Animal'
  | 'Musique'
  | 'Météo'
  | 'Transport'
  | 'Moteur'
  | 'Domestique'
  | 'Sonnerie / Alarme'
  | 'Autre'

export interface CategoryMapping {
  category: AudioCategory
  color: string
}

interface Range {
  from: number
  to: number
  category: AudioCategory
  color: string
}

const CATEGORY_RANGES: Range[] = [
  { from:   0, to: 131, category: 'Humain / Animal',   color: '#7F77DD' },
  { from: 132, to: 276, category: 'Musique',           color: '#D85A30' },
  { from: 277, to: 292, category: 'Météo',             color: '#378ADD' },
  { from: 293, to: 336, category: 'Transport',         color: '#1D9E75' },
  { from: 337, to: 347, category: 'Moteur',            color: '#BA7517' },
  { from: 348, to: 376, category: 'Domestique',        color: '#888780' },
  { from: 377, to: 399, category: 'Sonnerie / Alarme', color: '#E24B4A' },
]

const FALLBACK: CategoryMapping = { category: 'Autre', color: '#B4B2A9' }

export const ALL_CATEGORIES: CategoryMapping[] = [
  ...CATEGORY_RANGES.map((r) => ({ category: r.category, color: r.color })),
  FALLBACK,
]

export function mapYamnetIndex(index: number): CategoryMapping {
  for (const r of CATEGORY_RANGES) {
    if (index >= r.from && index <= r.to) {
      return { category: r.category, color: r.color }
    }
  }
  return FALLBACK
}
