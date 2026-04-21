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
 * Calcule l'enveloppe RMS d'un segment d'un fichier audio SANS le décoder
 * entièrement en mémoire. Essentiel pour les gros MP3 (> 1h) que
 * `decodeAudioData` ne peut pas manipuler.
 *
 * Technique : un HTMLAudioElement pilote la lecture en streaming (le
 * browser n'a qu'à garder les frames courants en mémoire). On branche un
 * AnalyserNode dessus via un MediaElementAudioSourceNode et on
 * échantillonne le RMS temps-domaine environ une fois par seconde de
 * temps audio. La lecture est accélérée (playbackRate 16× si le browser
 * l'accepte) pour que l'analyse soit rapide, et mise en silence via un
 * GainNode à 0 (on ne peut pas `audio.muted` une fois routée vers
 * AudioContext).
 *
 * Limite pratique : fenêtre ≤ ~2 h, sinon la lecture accélérée prend
 * trop de temps. L'appelant doit valider.
 */
export async function computePartialRmsEnvelope(
  blobUrl: string,
  startSec: number,
  endSec: number,
  options: {
    /** Vitesse de lecture souhaitée (clampée au max supporté par le browser) */
    playbackRate?: number
    /** Callback de progression en fraction 0..1 */
    onProgress?: (pct: number) => void
    /** Flag d'annulation (ref mutable, pas un AbortSignal). */
    signal?: { cancelled: boolean }
  } = {},
): Promise<{ env: number[]; audioStartSec: number; step: number }> {
  if (endSec <= startSec) throw new Error('Fenêtre vide')

  const audio = new Audio()
  audio.preload = 'auto'
  audio.src = blobUrl

  // Attente des métadonnées (durée, sample rate décodable…)
  await new Promise<void>((resolve, reject) => {
    const onMeta = () => { cleanup(); resolve() }
    const onErr = () => { cleanup(); reject(new Error('Impossible de charger le fichier audio (métadonnées illisibles)')) }
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('error', onErr)
    }
    audio.addEventListener('loadedmetadata', onMeta, { once: true })
    audio.addEventListener('error', onErr, { once: true })
  })

  if (options.signal?.cancelled) throw new Error('Annulé')

  const duration = Number.isFinite(audio.duration) ? audio.duration : endSec
  endSec = Math.min(endSec, duration)
  startSec = Math.max(0, startSec)
  if (endSec - startSec < 2) throw new Error('Fenêtre audio trop courte')

  const ctx: AudioContext = new AudioContext()
  let source: MediaElementAudioSourceNode | null = null
  let analyser: AnalyserNode | null = null
  let gain: GainNode | null = null
  const env: number[] = []

  try {
    source = ctx.createMediaElementSource(audio)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    gain = ctx.createGain()
    gain.gain.value = 0 // silencieux — l'analyser tourne quand même
    source.connect(analyser)
    analyser.connect(gain)
    gain.connect(ctx.destination)

    // Seek au début de la fenêtre
    audio.currentTime = startSec
    await new Promise<void>((resolve) => {
      const onSeeked = () => { audio.removeEventListener('seeked', onSeeked); resolve() }
      audio.addEventListener('seeked', onSeeked, { once: true })
    })

    // Lecture accélérée. Les browsers clampent silencieusement si > 16.
    audio.playbackRate = options.playbackRate ?? 16
    await audio.play()

    const buf = new Float32Array(analyser.fftSize)
    const totalDur = endSec - startSec
    await new Promise<void>((resolve, reject) => {
      let lastSampleSec = startSec - 1
      let rafId = 0
      const tick = () => {
        if (options.signal?.cancelled) {
          cancelAnimationFrame(rafId)
          reject(new Error('Annulé'))
          return
        }
        const cur = audio.currentTime
        if (cur >= endSec - 0.05 || audio.ended) {
          cancelAnimationFrame(rafId)
          resolve()
          return
        }
        // 1 échantillon par seconde de temps audio
        if (cur - lastSampleSec >= 1) {
          analyser!.getFloatTimeDomainData(buf)
          let sumSq = 0
          for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i]
          const rms = Math.sqrt(sumSq / buf.length)
          env.push(rms > 1e-6 ? 20 * Math.log10(rms) : -120)
          lastSampleSec = cur
          options.onProgress?.((cur - startSec) / totalDur)
        }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    })
  } finally {
    try { audio.pause() } catch { /* ignore */ }
    try { source?.disconnect() } catch { /* ignore */ }
    try { analyser?.disconnect() } catch { /* ignore */ }
    try { gain?.disconnect() } catch { /* ignore */ }
    try { await ctx.close() } catch { /* ignore */ }
    audio.removeAttribute('src')
    try { audio.load() } catch { /* ignore */ }
  }

  return { env, audioStartSec: startSec, step: 1 }
}

/**
 * Cherche le meilleur décalage `shiftSec` tel que l'enveloppe RMS audio
 * (partielle, commençant à `audioStartSec` dans le fichier) s'aligne sur
 * une série LAeq de référence (par minute, commençant à `laeqStartSec`
 * secondes depuis minuit).
 *
 * `shiftSec` est le décalage à APPLIQUER à la startTime courante de
 * l'entrée audio pour qu'elle colle à la courbe LAeq : la nouvelle
 * startTime réelle = `currentStartSec + shiftSec`.
 *
 * @param audioEnv      enveloppe RMS audio, 1 pt/s
 * @param audioStartSec audio time du 1er point d'audioEnv
 * @param laeqPerMinute LAeq par minute (dB), aligné sur l'axe real-time
 * @param laeqStartMin  minutes depuis minuit du 1er point de laeqPerMinute
 * @param laeqEndMin    minutes depuis minuit du dernier point (exclu)
 * @param currentStartSec  startTime actuelle de l'entrée (en s depuis minuit)
 * @param minShiftSec   shift minimal à tester (≤ 0 typiquement)
 * @param maxShiftSec   shift maximal à tester (≥ 0 typiquement)
 * @param stepSec       pas de recherche (défaut 60 s)
 */
export function findBestShiftPartial(
  audioEnv: number[],
  audioStartSec: number,
  laeqPerMinute: number[],
  laeqStartMin: number,
  laeqEndMin: number,
  currentStartSec: number,
  minShiftSec: number,
  maxShiftSec: number,
  stepSec = 60,
): { shiftSec: number; correlation: number } | null {
  if (audioEnv.length === 0) return null

  // On se place à la résolution minute côté audio aussi — ça stabilise la
  // corrélation quand l'audio est sous-échantillonné.
  const audioPerMinute: number[] = []
  for (let m = 0; m * 60 < audioEnv.length; m++) {
    let sumSq = 0, n = 0
    for (let s = m * 60; s < Math.min(audioEnv.length, (m + 1) * 60); s++) {
      const v = audioEnv[s]
      if (Number.isFinite(v)) { sumSq += v * v; n += 1 }
    }
    audioPerMinute.push(n > 0 ? Math.sqrt(sumSq / n) : 0)
  }
  const audioPerMinuteStartMin = audioStartSec / 60

  let bestShift = 0
  let bestR = -2
  for (let shift = minShiftSec; shift <= maxShiftSec; shift += stepSec) {
    const a: number[] = []
    const l: number[] = []
    for (let k = 0; k < laeqPerMinute.length; k++) {
      const realMin = laeqStartMin + k
      if (realMin >= laeqEndMin) break
      // audio time = real time - (currentStart + shift)
      const audioTimeMin = realMin - (currentStartSec + shift) / 60
      const audioIdx = Math.round(audioTimeMin - audioPerMinuteStartMin)
      if (audioIdx < 0 || audioIdx >= audioPerMinute.length) continue
      a.push(audioPerMinute[audioIdx])
      l.push(laeqPerMinute[k])
    }
    if (a.length < 5) continue
    const r = pearsonCorrelation(a, l)
    if (r > bestR) { bestR = r; bestShift = shift }
  }
  return bestR > -1 ? { shiftSec: bestShift, correlation: bestR } : null
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
