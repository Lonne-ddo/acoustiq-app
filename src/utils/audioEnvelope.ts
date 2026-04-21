/**
 * Enveloppe RMS d'un signal audio — utilisé pour calibrer un fichier
 * audio sur la courbe LAeq via corrélation (mode 3 du panneau de calage).
 *
 * La référence dB n'est pas étalonnée (pas de calibration SPL réelle :
 * on ne connaît pas le gain du micro / préampli / convertisseur). Ce qui
 * nous intéresse ici, c'est **la forme** de la courbe — les événements
 * sonores forts ressortent de la même manière dans l'audio que dans la
 * mesure LAeq du sonomètre, donc une corrélation de Pearson sur les
 * deux signaux normalisés suffit à identifier l'offset temporel correct.
 */

export interface EnvelopePoint {
  /** Secondes depuis le début de l'enregistrement audio */
  tSec: number
  /** Niveau dB relatif (0 dBFS = RMS max théorique) */
  db: number
}

/**
 * Décode un blob audio (partiellement) via AudioContext.decodeAudioData.
 *
 * /!\ Pour un MP3 de 600 Mo, cette opération peut consommer plusieurs
 * gigaoctets de RAM une fois décodé en PCM. Elle n'est donc invoquée
 * qu'en mode 3 (corrélation) et l'appelant doit afficher un spinner.
 *
 * Au besoin, on pourrait lire uniquement la plage temporelle nécessaire
 * à la corrélation (fenêtre utilisateur) — laissé en amélioration future.
 */
export async function decodeBlobUrl(blobUrl: string): Promise<AudioBuffer> {
  const resp = await fetch(blobUrl)
  const arr = await resp.arrayBuffer()
  // Utilise un AudioContext minimal — on ne garde pas la ref au-delà du decode
  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(arr)
  } finally {
    // Fermer pour libérer les ressources audio hardware
    try { await ctx.close() } catch { /* ignore */ }
  }
}

/**
 * Calcule l'enveloppe RMS d'un AudioBuffer par fenêtre de `windowSeconds`.
 * Moyenne sur tous les canaux puis applique 20·log10(rms) pour retourner
 * un niveau dB relatif (dBFS). Les échantillons silencieux sont plafonnés
 * à -120 dB pour éviter les `-Infinity`.
 */
export function computeRmsEnvelope(
  audioBuffer: AudioBuffer,
  windowSeconds = 1,
): EnvelopePoint[] {
  const sampleRate = audioBuffer.sampleRate
  const windowSamples = Math.max(1, Math.floor(windowSeconds * sampleRate))
  const numChannels = audioBuffer.numberOfChannels
  const length = audioBuffer.length

  // On accumule sumSquares canal-par-canal pour une moyenne énergétique
  const out: EnvelopePoint[] = []
  const channels: Float32Array[] = []
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c))
  }

  for (let start = 0; start < length; start += windowSamples) {
    const end = Math.min(length, start + windowSamples)
    const n = end - start
    if (n <= 0) break
    let sumSq = 0
    for (let c = 0; c < numChannels; c++) {
      const data = channels[c]
      for (let i = start; i < end; i++) {
        const v = data[i]
        sumSq += v * v
      }
    }
    const rms = Math.sqrt(sumSq / (n * numChannels))
    const db = rms > 1e-6 ? 20 * Math.log10(rms) : -120
    out.push({ tSec: start / sampleRate, db })
  }
  return out
}

/**
 * Corrélation de Pearson entre deux séries numériques de même longueur.
 * Retourne une valeur dans [-1, 1] ; 1 = identiques à un facteur d'échelle
 * près, 0 = non corrélées.
 */
export function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let sumA = 0, sumB = 0
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i] }
  const meanA = sumA / n
  const meanB = sumB / n
  let num = 0, denA = 0, denB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    num += da * db
    denA += da * da
    denB += db * db
  }
  const den = Math.sqrt(denA * denB)
  return den > 1e-9 ? num / den : 0
}

/**
 * Cherche le meilleur offset temporel (en secondes) qui aligne l'enveloppe
 * audio RMS avec une série LAeq de référence, dans une plage d'offsets
 * donnée. Le pas `stepSec` contrôle la résolution de la recherche.
 *
 * @param audioEnvelope enveloppe RMS de l'audio (1 pt/s typiquement)
 * @param laeqSeries    série LAeq par seconde sur la fenêtre de recherche,
 *                      `laeqSeries[k]` correspond à l'instant `windowStartSec + k`
 * @param windowStartSec secondes depuis minuit du 1er point de `laeqSeries`
 * @param minOffsetSec offset minimal à tester (négatif possible)
 * @param maxOffsetSec offset maximal à tester
 * @param stepSec      pas de recherche (défaut 1 s)
 * @returns { offsetSec, correlation } ou null si aucune correspondance
 */
export function findBestOffset(
  audioEnvelope: EnvelopePoint[],
  laeqSeries: number[],
  windowStartSec: number,
  minOffsetSec: number,
  maxOffsetSec: number,
  stepSec = 1,
): { offsetSec: number; correlation: number } | null {
  if (audioEnvelope.length === 0 || laeqSeries.length === 0) return null
  // Interpolation grossière : on suppose 1 point par seconde des deux côtés
  const audioDb = audioEnvelope.map((p) => p.db)
  let bestOffset = 0
  let bestR = -2
  const maxLen = Math.min(audioDb.length, laeqSeries.length)
  for (let off = minOffsetSec; off <= maxOffsetSec; off += stepSec) {
    // L'enveloppe audio est alignée au temps réel en décalant de `off` secondes.
    // L'instant "absolu" du kᵉ point de laeqSeries est windowStartSec + k.
    // On cherche l'index correspondant dans l'enveloppe audio.
    const audioStartSec = windowStartSec + off
    const startIdx = Math.round(audioStartSec)
    if (startIdx < 0) continue
    const end = Math.min(audioDb.length, startIdx + maxLen)
    if (end - startIdx < 10) continue // besoin d'au moins 10 s pour une corrélation fiable
    const aSlice = audioDb.slice(startIdx, end)
    const bSlice = laeqSeries.slice(0, end - startIdx)
    const r = pearsonCorrelation(aSlice, bSlice)
    if (r > bestR) {
      bestR = r
      bestOffset = off
    }
  }
  return bestR > -1 ? { offsetSec: bestOffset, correlation: bestR } : null
}
