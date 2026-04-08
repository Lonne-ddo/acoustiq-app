/**
 * Pipeline de classification audio YAMNet — entièrement client-side.
 *
 *  1. Le modèle YAMNet est chargé depuis TF Hub via `tf.loadGraphModel`
 *     (mis en cache navigateur après le premier chargement).
 *  2. L'AudioBuffer est ramené à mono 16 kHz via `OfflineAudioContext`
 *     (resampling natif, beaucoup plus rapide que la lecture temps réel).
 *  3. L'audio est découpé en segments de 1 seconde (16 000 échantillons).
 *  4. Pour chaque segment : forward pass → score moyen sur les frames →
 *     classe top-1 → mapping vers une des 7 catégories AcoustiQ.
 *  5. Traitement par blocs de 60 segments avec un `await setTimeout(0)`
 *     pour rendre la main à l'UI et mettre à jour la progress bar.
 *
 * Le modèle expose 3 sorties [scores, embeddings, log-mel] ; on n'utilise
 * que la première (scores) qui est de shape [N_frames, 521].
 */
import * as tf from '@tensorflow/tfjs'
import { mapYamnetIndex, type CategoryMapping } from './yamnetMapping'

const TARGET_RATE = 16000
const FRAME_SAMPLES = 16000 // 1 seconde
const MODEL_URL = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1'

// Module-level cache pour ne charger le modèle qu'une fois par session
let modelPromise: Promise<tf.GraphModel> | null = null

export async function loadYamnetModel(): Promise<tf.GraphModel> {
  if (modelPromise) return modelPromise
  modelPromise = tf.loadGraphModel(MODEL_URL, { fromTFHub: true })
  return modelPromise
}

/**
 * Convertit un AudioBuffer (n canaux, sample rate quelconque) en
 * Float32Array mono 16 kHz via OfflineAudioContext (resampling natif rapide).
 */
export async function resampleToMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  const targetLength = Math.ceil(buffer.duration * TARGET_RATE)
  const offline = new OfflineAudioContext(1, targetLength, TARGET_RATE)

  let mono: AudioBuffer
  if (buffer.numberOfChannels === 1) {
    mono = buffer
  } else {
    // Mixage downmix → 1 canal (moyenne)
    mono = offline.createBuffer(1, buffer.length, buffer.sampleRate)
    const out = mono.getChannelData(0)
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c)
      for (let i = 0; i < buffer.length; i++) {
        out[i] += data[i] / buffer.numberOfChannels
      }
    }
  }

  const source = offline.createBufferSource()
  source.buffer = mono
  source.connect(offline.destination)
  source.start(0)
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0).slice()
}

// ─── Types publics ──────────────────────────────────────────────────────────

export interface ClassifiedSegment {
  /** Début du segment depuis le début de l'audio (secondes) */
  timeStart: number
  /** Fin du segment depuis le début de l'audio (secondes) */
  timeEnd: number
  /** Catégorie AcoustiQ (parmi les 7 + Autre) */
  category: CategoryMapping['category']
  /** Couleur associée (hex) */
  color: string
  /** Score de confiance 0–1 (probabilité du top class) */
  score: number
  /** Index brut YAMNet (0–520) */
  rawIndex: number
  /** Nom brut YAMNet (best-effort, sinon "class_<idx>") */
  rawClass: string
}

export interface ClassifyOptions {
  /** Notifié dès que le chargement du modèle commence (UI : "Chargement…") */
  onModelLoading?: () => void
  /** Notifié quand le modèle est prêt (UI : "Analyse en cours…") */
  onModelReady?: () => void
  /** Progression : 0..1 */
  onProgress?: (progress: number) => void
  /** Plage à analyser : début (s) — défaut 0 */
  rangeStartSec?: number
  /** Plage à analyser : durée (s) — défaut totalité */
  rangeDurationSec?: number
  /** Annulation utilisateur */
  signal?: AbortSignal
}

// ─── Noms YAMNet (best-effort, lazy-fetch) ──────────────────────────────────
const CLASS_MAP_URL =
  'https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv'
let classNamesPromise: Promise<string[]> | null = null

async function loadClassNames(): Promise<string[]> {
  if (classNamesPromise) return classNamesPromise
  classNamesPromise = (async () => {
    try {
      const res = await fetch(CLASS_MAP_URL)
      if (!res.ok) return []
      const csv = await res.text()
      const lines = csv.split('\n').slice(1)
      const names: string[] = []
      for (const line of lines) {
        // Format CSV: index,mid,display_name
        const parts = parseCsvLine(line)
        if (parts.length >= 3) names.push(parts[2])
      }
      return names
    } catch {
      return []
    }
  })()
  return classNamesPromise
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQ = false
      else cur += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}

// ─── Classification ─────────────────────────────────────────────────────────

export async function classifyAudio(
  buffer: AudioBuffer,
  options: ClassifyOptions = {},
): Promise<ClassifiedSegment[]> {
  options.onModelLoading?.()
  const [model, classNames] = await Promise.all([loadYamnetModel(), loadClassNames()])
  options.onModelReady?.()

  const samples = await resampleToMono16k(buffer)

  const startSec = Math.max(0, options.rangeStartSec ?? 0)
  const durSec =
    options.rangeDurationSec !== undefined
      ? Math.min(options.rangeDurationSec, buffer.duration - startSec)
      : buffer.duration - startSec

  const startSample = Math.floor(startSec * TARGET_RATE)
  const endSample = Math.min(samples.length, startSample + Math.floor(durSec * TARGET_RATE))
  const totalSegments = Math.max(0, Math.ceil((endSample - startSample) / FRAME_SAMPLES))

  const out: ClassifiedSegment[] = []
  const padded = new Float32Array(FRAME_SAMPLES)

  for (let segIdx = 0; segIdx < totalSegments; segIdx++) {
    if (options.signal?.aborted) break

    const a = startSample + segIdx * FRAME_SAMPLES
    const b = Math.min(endSample, a + FRAME_SAMPLES)
    const slice = samples.subarray(a, b)
    let chunk: Float32Array
    if (slice.length === FRAME_SAMPLES) {
      chunk = slice
    } else {
      padded.fill(0)
      padded.set(slice)
      chunk = padded
    }

    // Forward pass — tf.tidy nettoie tous les tensors intermédiaires
    const meanScores = tf.tidy(() => {
      const input = tf.tensor1d(chunk)
      const output = model.predict(input) as tf.Tensor | tf.Tensor[]
      // YAMNet renvoie [scores, embeddings, spectrogram] sur certaines versions,
      // ou un seul Tensor scores. On prend la sortie de plus haut rang qui ait
      // 521 dans sa dernière dimension.
      const tensors = Array.isArray(output) ? output : [output]
      let scoresT: tf.Tensor | null = null
      for (const t of tensors) {
        const last = t.shape[t.shape.length - 1]
        if (last === 521) {
          scoresT = t
          break
        }
      }
      if (!scoresT) scoresT = tensors[0]
      // Si rang ≥ 2, mean sur l'axe 0 (frames) ; sinon déjà 1D
      const meanT = scoresT.rank >= 2 ? scoresT.mean(0) : scoresT
      return meanT.dataSync() as Float32Array
    })

    // Top-1
    let maxIdx = 0
    let maxVal = -Infinity
    for (let i = 0; i < meanScores.length; i++) {
      if (meanScores[i] > maxVal) {
        maxVal = meanScores[i]
        maxIdx = i
      }
    }

    const mapping = mapYamnetIndex(maxIdx)
    out.push({
      timeStart: a / TARGET_RATE,
      timeEnd: b / TARGET_RATE,
      category: mapping.category,
      color: mapping.color,
      score: Math.max(0, Math.min(1, maxVal)),
      rawIndex: maxIdx,
      rawClass: classNames[maxIdx] ?? `class_${maxIdx}`,
    })

    // Yield à l'UI tous les 60 segments pour éviter le blocage
    if ((segIdx + 1) % 60 === 0 || segIdx === totalSegments - 1) {
      options.onProgress?.((segIdx + 1) / totalSegments)
      // microtask + setTimeout(0) pour laisser respirer le navigateur
      await new Promise<void>((r) => setTimeout(r, 0))
    }
  }

  options.onProgress?.(1)
  return out
}

// ─── Helpers post-traitement (résumé / export) ──────────────────────────────

export interface CategoryStat {
  category: CategoryMapping['category']
  color: string
  seconds: number
  fraction: number
}

export function summarizeByCategory(segments: ClassifiedSegment[]): CategoryStat[] {
  const totals = new Map<string, { color: string; seconds: number }>()
  let total = 0
  for (const s of segments) {
    const dur = s.timeEnd - s.timeStart
    total += dur
    const existing = totals.get(s.category)
    if (existing) existing.seconds += dur
    else totals.set(s.category, { color: s.color, seconds: dur })
  }
  const out: CategoryStat[] = []
  for (const [category, v] of totals) {
    out.push({
      category: category as CategoryMapping['category'],
      color: v.color,
      seconds: v.seconds,
      fraction: total > 0 ? v.seconds / total : 0,
    })
  }
  out.sort((a, b) => b.seconds - a.seconds)
  return out
}

export function segmentsToCSV(segments: ClassifiedSegment[]): string {
  const headers = ['time_start_s', 'time_end_s', 'category', 'score', 'raw_class_name']
  const lines = [headers.join(',')]
  for (const s of segments) {
    lines.push(
      [
        s.timeStart.toFixed(2),
        s.timeEnd.toFixed(2),
        `"${s.category}"`,
        s.score.toFixed(4),
        `"${s.rawClass.replace(/"/g, '""')}"`,
      ].join(','),
    )
  }
  return '\uFEFF' + lines.join('\n')
}
