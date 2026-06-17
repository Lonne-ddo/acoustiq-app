/**
 * Extraction et pondération de spectres 1/3 d'octave pour le panneau
 * « Spectre instantané ».
 *
 *  - spectre à un instant (interpolation linéaire entre les deux échantillons
 *    encadrants) ;
 *  - spectre moyen sur une plage (moyenne énergétique par bande) + extrema
 *    réels LFmin/LFmax par bande ;
 *  - application des pondérations Z (linéaire) / A / C.
 *
 * Les niveaux d'entrée (`dp.spectra`) sont des LZeq par bande (non pondérés).
 */
import type { DataPoint } from '../types'
import { A_WEIGHTING, C_WEIGHTING, type Weighting } from './weighting'

export type { Weighting }

/** Pondération C par bande 1/3 d'octave (dB), CEI 61672 — table complète. */
export const C_WEIGHT = C_WEIGHTING

/** Applique la pondération choisie à un spectre LZeq aligné sur `freqs`. */
export function applyWeighting(spectrum: number[], freqs: number[], w: Weighting): number[] {
  if (w === 'Z') return spectrum
  const table = w === 'A' ? A_WEIGHTING : C_WEIGHTING
  return spectrum.map((v, i) => v + (table[freqs[i]] ?? 0))
}

/** Échantillon réduit aux seules lignes porteuses de spectre (trié par t). */
export interface SpectraSample {
  t: number
  spectra: number[]
}

/** Précalcule (une fois) les échantillons porteurs de spectre, triés par temps. */
export function buildSpectraSamples(data: DataPoint[]): SpectraSample[] {
  const out: SpectraSample[] = []
  for (const dp of data) {
    if (dp.spectra && dp.spectra.length > 0) out.push({ t: dp.t, spectra: dp.spectra })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

/** Recherche binaire : plus grand index dont t <= cible (-1 si aucun). */
function lowerBound(samples: SpectraSample[], t: number): number {
  let lo = 0, hi = samples.length - 1, res = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= t) { res = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return res
}

/**
 * Spectre à l'instant `tMin` (minutes) par interpolation linéaire entre les
 * deux échantillons encadrants. Renvoie null si aucun échantillon spectral.
 */
export function spectrumAtInstant(samples: SpectraSample[], tMin: number): number[] | null {
  if (samples.length === 0) return null
  const i = lowerBound(samples, tMin)
  if (i < 0) return samples[0].spectra.slice()
  if (i >= samples.length - 1) return samples[samples.length - 1].spectra.slice()
  const a = samples[i], b = samples[i + 1]
  const span = b.t - a.t
  if (span <= 0) return a.spectra.slice()
  const frac = Math.max(0, Math.min(1, (tMin - a.t) / span))
  const n = Math.min(a.spectra.length, b.spectra.length)
  const out = new Array(n)
  for (let k = 0; k < n; k++) out[k] = a.spectra[k] + frac * (b.spectra[k] - a.spectra[k])
  return out
}

export interface RangeSpectrum {
  /** Moyenne énergétique par bande (Leq). */
  leq: number[]
  /** Minimum réel par bande (LFmin). */
  min: number[]
  /** Maximum réel par bande (LFmax). */
  max: number[]
  /** Nombre d'échantillons agrégés. */
  count: number
}

/**
 * Spectre moyen énergétique + extrema réels (min/max) par bande sur la plage
 * [startMin, endMin]. Renvoie null si aucun échantillon dans la plage.
 */
export function spectrumOverRange(
  samples: SpectraSample[],
  startMin: number,
  endMin: number,
): RangeSpectrum | null {
  const lo = Math.min(startMin, endMin)
  const hi = Math.max(startMin, endMin)
  let nBands = 0
  for (const s of samples) {
    if (s.t >= lo && s.t <= hi) { nBands = Math.max(nBands, s.spectra.length); }
  }
  if (nBands === 0) return null
  const pow = new Array(nBands).fill(0)
  const cnt = new Array(nBands).fill(0)
  const min = new Array(nBands).fill(Infinity)
  const max = new Array(nBands).fill(-Infinity)
  let count = 0
  for (const s of samples) {
    if (s.t < lo || s.t > hi) continue
    count++
    for (let k = 0; k < s.spectra.length && k < nBands; k++) {
      const v = s.spectra[k]
      if (!Number.isFinite(v)) continue
      pow[k] += Math.pow(10, v / 10)
      cnt[k]++
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  if (count === 0) return null
  const leq = pow.map((p, k) => (cnt[k] > 0 ? 10 * Math.log10(p / cnt[k]) : NaN))
  return {
    leq,
    min: min.map((v) => (Number.isFinite(v) ? v : NaN)),
    max: max.map((v) => (Number.isFinite(v) ? v : NaN)),
    count,
  }
}

/** Étiquette d'axe pour une fréquence (1000 → « 1k »). */
export function freqAxisLabel(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`
  }
  return String(hz)
}
