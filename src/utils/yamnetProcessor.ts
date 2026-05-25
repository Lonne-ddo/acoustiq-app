/**
 * Pipeline de classification audio YAMNet — 100 % client-side.
 *
 * Aligné sur le standalone yamnet_classifier_standalone.html :
 *  1. AudioBuffer → mono 16 kHz via OfflineAudioContext (resampling natif).
 *  2. Backend TensorFlow.js forcé sur CPU (fiabilité maximale ; évite les
 *     bugs WebGL/WebGPU selon les pilotes / GPU intégrés).
 *  3. Inférence par chunks de 240 s → scores de frames YAMNet (hop ≈ 0,48 s),
 *     de shape [N_frames, 521], concaténés.
 *  4. Segmentation configurable (durée + chevauchement). Pour chaque segment :
 *       moyenne des scores de frames par classe
 *       → somme par catégorie (mapping 521 → 7)
 *       → normalisation (somme = 1)
 *       → catégorie dominante (argmax) + drapeau « incertain » sous le seuil.
 *
 * Le modèle YAMNet expose [scores, embeddings, log-mel] ; on prend la sortie
 * dont la dernière dimension vaut 521 (les scores).
 */
import * as tf from '@tensorflow/tfjs'
import {
  CATEGORIES,
  CATEGORY_IDS,
  CLASS_NAMES,
  CLASS_TO_CAT,
  INDETERMINE_ID,
  type CategoryId,
} from '../data/yamnetCategories'

const TARGET_RATE = 16000
/** Hop natif YAMNet entre frames (s). */
const FRAME_HOP = 0.48
/** Taille de chunk d'inférence (s) pour borner la RAM. */
const CHUNK_SECONDS = 240
/** Couleur des segments incertains (= catégorie « Indéterminé »). */
const UNCERTAIN_COLOR = CATEGORIES[INDETERMINE_ID].color

/** Sources du modèle, essayées dans l'ordre. */
const MODEL_CANDIDATES: { url: string; opts: tf.io.LoadOptions }[] = [
  { url: 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1', opts: { fromTFHub: true } },
  { url: 'https://storage.googleapis.com/tfjs-models/savedmodel/yamnet/model.json', opts: {} },
]

// ─── Paramètres par défaut (alignés sur le standalone) ──────────────────────
export const DEFAULT_SEGMENT_DURATION = 5 // s (plage 1–10)
export const DEFAULT_OVERLAP = 0 // 0 | 0.25 | 0.5 | 0.75
export const DEFAULT_THRESHOLD = 0.3 // 30 % (plage 0–0.8)

// ─── Types publics ──────────────────────────────────────────────────────────

export interface SegmentTopClass {
  name: string
  /** Score brut YAMNet (moyenne sur les frames du segment). */
  score: number
  /** Catégorie (1..7) de cette classe. */
  catId: number
}

export interface ClassifiedSegment {
  /** Début du segment depuis le début de l'audio (s). */
  timeStart: number
  /** Fin du segment depuis le début de l'audio (s). */
  timeEnd: number
  /** Catégorie dominante (id "1".."7"). */
  dominantCat: CategoryId
  /** Nom affiché : catégorie dominante, ou « Incertain » sous le seuil. */
  category: string
  /** Couleur d'affichage (catégorie dominante, ou gris si incertain). */
  color: string
  /** Score normalisé de la catégorie dominante (0–1). */
  score: number
  /** Vrai si le score dominant est sous le seuil de confiance. */
  uncertain: boolean
  /** Scores normalisés par catégorie (somme = 1). */
  catScores: Record<CategoryId, number>
  /** Top 3 des classes YAMNet brutes du segment. */
  top3: SegmentTopClass[]
}

export interface ClassifyOptions {
  /** Durée de segment (s) — défaut 5. */
  segmentDuration?: number
  /** Chevauchement 0–0,75 — défaut 0. */
  overlap?: number
  /** Seuil de confiance 0–1 — défaut 0,30. */
  threshold?: number
  /** Plage à analyser : début (s) — défaut 0. */
  rangeStartSec?: number
  /** Plage à analyser : durée (s) — défaut totalité. */
  rangeDurationSec?: number
  onModelLoading?: () => void
  onModelReady?: () => void
  onProgress?: (progress: number) => void
  /** Journal technique (panneau diagnostic). */
  onLog?: (level: 'info' | 'warn' | 'error' | 'success', msg: string) => void
  signal?: AbortSignal
}

// ─── Backend + modèle ───────────────────────────────────────────────────────

let modelPromise: Promise<tf.GraphModel> | null = null
let loadedModelUrl = ''
let backendName = ''

export function getYamnetDiagnostics(): { backend: string; modelUrl: string } {
  return { backend: backendName, modelUrl: loadedModelUrl }
}

async function ensureCpuBackend(
  log?: ClassifyOptions['onLog'],
): Promise<void> {
  await tf.ready()
  log?.('info', `Backend TF.js initial : ${tf.getBackend()}`)
  try {
    await tf.setBackend('cpu')
    await tf.ready()
    log?.('info', 'Backend forcé sur CPU (fiabilité maximale, ~2–3× plus lent que WebGL)')
  } catch (e) {
    log?.('warn', `Impossible de forcer CPU : ${(e as Error).message || e}`)
  }
  backendName = tf.getBackend()
}

async function loadYamnetModel(
  log?: ClassifyOptions['onLog'],
): Promise<tf.GraphModel> {
  if (modelPromise) return modelPromise
  modelPromise = (async () => {
    await ensureCpuBackend(log)
    let lastErr: unknown = null
    for (const c of MODEL_CANDIDATES) {
      try {
        const m = await tf.loadGraphModel(c.url, c.opts)
        loadedModelUrl = c.url
        log?.('success', `Modèle YAMNet chargé : ${c.url}`)
        return m
      } catch (e) {
        lastErr = e
        log?.('warn', `Échec du chargement (${c.url}) : ${(e as Error).message}`)
      }
    }
    modelPromise = null // permettre une nouvelle tentative
    throw new Error(
      `Chargement du modèle YAMNet impossible. ${
        lastErr instanceof Error ? lastErr.message : ''
      }`,
    )
  })()
  return modelPromise
}

/**
 * Convertit un AudioBuffer (n canaux, sample rate quelconque) en
 * Float32Array mono 16 kHz via OfflineAudioContext (resampling natif rapide).
 */
export async function resampleToMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  // Downmix mono d'abord (moyenne des canaux), au sample rate d'origine.
  const lenSrc = buffer.length
  const numCh = buffer.numberOfChannels
  const monoSrc = new Float32Array(lenSrc)
  for (let ch = 0; ch < numCh; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < lenSrc; i++) monoSrc[i] += data[i] / numCh
  }
  if (buffer.sampleRate === TARGET_RATE) return monoSrc

  const offline = new OfflineAudioContext(
    1,
    Math.ceil(buffer.duration * TARGET_RATE),
    TARGET_RATE,
  )
  const monoBuf = offline.createBuffer(1, lenSrc, buffer.sampleRate)
  monoBuf.getChannelData(0).set(monoSrc)
  const source = offline.createBufferSource()
  source.buffer = monoBuf
  source.connect(offline.destination)
  source.start(0)
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0).slice()
}

/** Inférence d'un chunk → scores de frames [N_frames][521]. */
async function inferChunk(
  model: tf.GraphModel,
  wave: Float32Array,
): Promise<number[][]> {
  const input = tf.tensor1d(wave, 'float32')
  let output: tf.Tensor | tf.Tensor[]
  try {
    output = model.predict(input) as tf.Tensor | tf.Tensor[]
  } catch {
    // Certaines versions exposent execute({waveform})
    output = model.execute({ waveform: input }) as tf.Tensor | tf.Tensor[]
  }
  const tensors = Array.isArray(output) ? output : [output]
  let scoresT: tf.Tensor =
    tensors.find((t) => t.shape[t.shape.length - 1] === 521) ?? tensors[0]
  const arr = (await scoresT.array()) as number[] | number[][]
  input.dispose()
  tensors.forEach((t) => t.dispose())
  // [N,521] attendu ; si 1D (un seul frame), on enveloppe.
  return Array.isArray(arr[0]) ? (arr as number[][]) : [arr as number[]]
}

/** Agrège les scores de frames en segments configurables. */
function buildSegments(
  allFrames: number[][],
  opts: Required<
    Pick<ClassifyOptions, 'segmentDuration' | 'overlap' | 'threshold' | 'rangeStartSec'>
  >,
): ClassifiedSegment[] {
  const { segmentDuration: segDur, overlap, threshold, rangeStartSec: offset } = opts
  const stepDur = segDur * (1 - overlap)
  const totalDur = allFrames.length * FRAME_HOP
  const numClasses = 521

  const segments: ClassifiedSegment[] = []
  for (let segStart = 0; segStart < totalDur; segStart += stepDur) {
    const segEnd = Math.min(segStart + segDur, totalDur)
    if (segEnd - segStart < segDur * 0.5) break // segment final trop court
    const frameStart = Math.floor(segStart / FRAME_HOP)
    const frameEnd = Math.min(Math.ceil(segEnd / FRAME_HOP), allFrames.length)
    if (frameEnd <= frameStart) continue
    const nF = frameEnd - frameStart

    // Moyenne des scores de frames par classe.
    const meanScores = new Float32Array(numClasses)
    for (let f = frameStart; f < frameEnd; f++) {
      const fs = allFrames[f]
      for (let k = 0; k < numClasses; k++) meanScores[k] += fs[k] / nF
    }

    // Somme par catégorie puis normalisation.
    const catScores = {} as Record<CategoryId, number>
    for (const id of CATEGORY_IDS) catScores[id] = 0
    for (let k = 0; k < numClasses; k++) {
      const cat = String(CLASS_TO_CAT[k]) as CategoryId
      catScores[cat] += meanScores[k]
    }
    let sumCat = 0
    for (const id of CATEGORY_IDS) sumCat += catScores[id]
    sumCat = sumCat || 1
    for (const id of CATEGORY_IDS) catScores[id] /= sumCat

    // Catégorie dominante.
    let dominantCat: CategoryId = INDETERMINE_ID
    let dominantScore = 0
    for (const id of CATEGORY_IDS) {
      if (catScores[id] > dominantScore) {
        dominantScore = catScores[id]
        dominantCat = id
      }
    }
    const uncertain = dominantScore < threshold

    // Top 3 classes brutes.
    const order = Array.from(meanScores.keys()).sort(
      (a, b) => meanScores[b] - meanScores[a],
    )
    const top3: SegmentTopClass[] = order.slice(0, 3).map((k) => ({
      name: CLASS_NAMES[k] ?? `class_${k}`,
      score: meanScores[k],
      catId: CLASS_TO_CAT[k],
    }))

    segments.push({
      timeStart: offset + segStart,
      timeEnd: offset + segEnd,
      dominantCat,
      category: uncertain ? 'Incertain' : CATEGORIES[dominantCat].name,
      color: uncertain ? UNCERTAIN_COLOR : CATEGORIES[dominantCat].color,
      score: dominantScore,
      uncertain,
      catScores,
      top3,
    })
  }
  return segments
}

// ─── Classification ─────────────────────────────────────────────────────────

export async function classifyAudio(
  buffer: AudioBuffer,
  options: ClassifyOptions = {},
): Promise<ClassifiedSegment[]> {
  const log = options.onLog
  options.onModelLoading?.()
  const model = await loadYamnetModel(log)
  options.onModelReady?.()

  const samples = await resampleToMono16k(buffer)

  const startSec = Math.max(0, options.rangeStartSec ?? 0)
  const durSec =
    options.rangeDurationSec !== undefined
      ? Math.min(options.rangeDurationSec, buffer.duration - startSec)
      : buffer.duration - startSec
  const startSample = Math.floor(startSec * TARGET_RATE)
  const endSample = Math.min(
    samples.length,
    startSample + Math.floor(durSec * TARGET_RATE),
  )
  const wave = samples.subarray(startSample, endSample)
  log?.('info', `Audio : ${durSec.toFixed(0)} s à 16 kHz (${wave.length} échantillons)`)

  // Inférence par chunks.
  const chunkSamples = CHUNK_SECONDS * TARGET_RATE
  const totalChunks = Math.max(1, Math.ceil(wave.length / chunkSamples))
  log?.('info', `Inférence en ${totalChunks} chunk(s) de ${CHUNK_SECONDS} s max`)

  const allFrames: number[][] = []
  for (let c = 0; c < totalChunks; c++) {
    if (options.signal?.aborted) break
    const a = c * chunkSamples
    const b = Math.min(wave.length, a + chunkSamples)
    const t0 = performance.now()
    const frames = await inferChunk(model, wave.subarray(a, b))
    for (const fr of frames) allFrames.push(fr)
    log?.(
      'info',
      `Chunk ${c + 1}/${totalChunks} : ${frames.length} frames en ${(
        (performance.now() - t0) / 1000
      ).toFixed(2)} s`,
    )
    options.onProgress?.(((c + 1) / totalChunks) * 0.92)
    await new Promise<void>((r) => setTimeout(r, 0))
  }

  if (options.signal?.aborted) {
    log?.('warn', 'Analyse interrompue.')
    return []
  }

  const segments = buildSegments(allFrames, {
    segmentDuration: options.segmentDuration ?? DEFAULT_SEGMENT_DURATION,
    overlap: options.overlap ?? DEFAULT_OVERLAP,
    threshold: options.threshold ?? DEFAULT_THRESHOLD,
    rangeStartSec: startSec,
  })
  options.onProgress?.(1)
  log?.('success', `${segments.length} segment(s) classifié(s)`)
  return segments
}

// ─── Post-traitement (résumé / export) ───────────────────────────────────────

export interface CategoryStat {
  /** id "1".."7" ou "uncertain". */
  key: string
  label: string
  color: string
  seconds: number
  fraction: number
}

/**
 * Distribution temporelle par catégorie dominante (les segments incertains
 * forment leur propre bucket « Incertain »).
 */
export function summarizeByCategory(segments: ClassifiedSegment[]): CategoryStat[] {
  const totals = new Map<string, { label: string; color: string; seconds: number }>()
  let total = 0
  for (const s of segments) {
    const dur = s.timeEnd - s.timeStart
    total += dur
    const key = s.uncertain ? 'uncertain' : s.dominantCat
    const label = s.uncertain ? 'Incertain' : CATEGORIES[s.dominantCat].name
    const color = s.color
    const existing = totals.get(key)
    if (existing) existing.seconds += dur
    else totals.set(key, { label, color, seconds: dur })
  }
  const out: CategoryStat[] = []
  for (const [key, v] of totals) {
    out.push({
      key,
      label: v.label,
      color: v.color,
      seconds: v.seconds,
      fraction: total > 0 ? v.seconds / total : 0,
    })
  }
  out.sort((a, b) => b.seconds - a.seconds)
  return out
}

export function segmentsToCSV(segments: ClassifiedSegment[]): string {
  const headers = [
    'time_start_s',
    'time_end_s',
    'categorie_dominante',
    'score_dominant',
    'incertain',
    ...CATEGORY_IDS.map((id) => `pct_${CATEGORIES[id].short}`),
    'top1',
    'top2',
    'top3',
  ]
  const lines = [headers.join(',')]
  const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  for (const s of segments) {
    lines.push(
      [
        s.timeStart.toFixed(2),
        s.timeEnd.toFixed(2),
        q(s.uncertain ? 'Incertain' : CATEGORIES[s.dominantCat].name),
        s.score.toFixed(4),
        s.uncertain ? 'oui' : 'non',
        ...CATEGORY_IDS.map((id) => (s.catScores[id] * 100).toFixed(1)),
        ...s.top3.map((t) => q(`${t.name} (${(t.score * 100).toFixed(0)}%)`)),
      ].join(','),
    )
  }
  return '﻿' + lines.join('\n')
}
