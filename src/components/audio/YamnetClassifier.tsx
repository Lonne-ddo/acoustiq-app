/**
 * YamnetClassifier — onglet « Audio IA ».
 *
 * Orchestre le pipeline YAMNet :
 *  - réutilise le WAV déjà chargé dans le projet (sidebar Options) ou
 *    permet d'en charger un nouveau localement à cette page,
 *  - analyse complète ou plage horaire,
 *  - barre de progression + état "Chargement modèle / Analyse",
 *  - tableau récap par catégorie,
 *  - export CSV + copie résumé pour le rapport.
 *
 * Les segments classifiés sont publiés vers `App` via `onSegmentsChange`
 * pour être affichés en overlay coloré sur `TimeSeriesChart`.
 */
import { useState, useRef, useMemo, useEffect } from 'react'
import {
  Brain,
  Upload,
  Play,
  Square as StopIcon,
  Download,
  ClipboardCopy,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import {
  classifyAudio,
  segmentsToCSV,
  summarizeByCategory,
  type ClassifiedSegment,
} from '../../utils/yamnetProcessor'
import { ALL_CATEGORIES } from '../../utils/yamnetMapping'
import type { AudioFile } from '../../types'

const MAX_SECONDS_FREE_RUN = 30 * 60 // 30 min

interface Props {
  /** WAV déjà chargé dans le projet (sidebar Options) — optionnel */
  audioFile: AudioFile | null
  /** Segments précédemment classifiés (persistés au niveau App) */
  segments: ClassifiedSegment[]
  /** Publie les segments vers App pour overlay sur TimeSeriesChart */
  onSegmentsChange: (segments: ClassifiedSegment[]) => void
}

type Phase = 'idle' | 'loading-model' | 'classifying' | 'done' | 'error'

export default function YamnetClassifier({
  audioFile,
  segments,
  onSegmentsChange,
}: Props) {
  const [localBuffer, setLocalBuffer] = useState<AudioBuffer | null>(null)
  const [localName, setLocalName] = useState<string | null>(null)
  const [useRange, setUseRange] = useState(false)
  const [rangeStartMin, setRangeStartMin] = useState('00:00')
  const [rangeDurationMin, setRangeDurationMin] = useState('5')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Pour le calcul d'ETA pendant l'analyse
  const startTimeRef = useRef<number>(0)
  const [etaSec, setEtaSec] = useState<number | null>(null)

  // Le buffer effectif vient soit du fichier projet, soit du fichier local
  const buffer: AudioBuffer | null = localBuffer ?? audioFile?.buffer ?? null
  const bufferName: string | null =
    localName ?? audioFile?.name ?? null
  const duration = buffer?.duration ?? 0
  const tooLong = duration > MAX_SECONDS_FREE_RUN

  // Auto-active l'option « Analyser une plage » pour les fichiers > 30 min
  useEffect(() => {
    if (tooLong && !useRange) setUseRange(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tooLong])

  async function handleLocalFile(file: File) {
    setError(null)
    try {
      const buf = await file.arrayBuffer()
      const ctx = new AudioContext()
      const decoded = await ctx.decodeAudioData(buf)
      await ctx.close()
      setLocalBuffer(decoded)
      setLocalName(file.name)
    } catch (err) {
      setError('Décodage WAV échoué : ' + String(err instanceof Error ? err.message : err))
    }
  }

  function parseHHMMtoSec(hhmm: string): number {
    const m = hhmm.match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return 0
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60
  }

  /** Format secondes → "mm:ss" (ou "h:mm:ss" si > 1 h) */
  function formatMmSs(seconds: number): string {
    const s = Math.max(0, Math.round(seconds))
    if (s < 3600) {
      const m = Math.floor(s / 60)
      const r = s % 60
      return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    }
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const r = s % 60
    return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  }

  async function handleRun() {
    if (!buffer) return
    setError(null)
    setPhase('loading-model')
    setProgress(0)
    setEtaSec(null)

    const controller = new AbortController()
    abortRef.current = controller

    let rangeStartSec: number | undefined
    let rangeDurationSec: number | undefined
    if (useRange) {
      rangeStartSec = parseHHMMtoSec(rangeStartMin)
      const min = parseFloat(rangeDurationMin.replace(',', '.'))
      rangeDurationSec = Number.isFinite(min) ? min * 60 : undefined
    }

    try {
      const result = await classifyAudio(buffer, {
        rangeStartSec,
        rangeDurationSec,
        signal: controller.signal,
        onModelLoading: () => setPhase('loading-model'),
        onModelReady: () => {
          setPhase('classifying')
          startTimeRef.current = performance.now()
        },
        onProgress: (p) => {
          setProgress(p)
          // Estimation du temps restant : (elapsed / progress) * (1 - progress)
          if (p > 0.02 && startTimeRef.current > 0) {
            const elapsedMs = performance.now() - startTimeRef.current
            const remainingMs = (elapsedMs / p) * (1 - p)
            setEtaSec(Math.max(0, Math.round(remainingMs / 1000)))
          }
        },
      })
      onSegmentsChange(result)
      setPhase('done')
      setEtaSec(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    } finally {
      abortRef.current = null
    }
  }

  function handleAbort() {
    abortRef.current?.abort()
    setPhase('idle')
  }

  function handleClear() {
    onSegmentsChange([])
    setPhase('idle')
    setProgress(0)
  }

  function handleExportCSV() {
    if (segments.length === 0) return
    const csv = segmentsToCSV(segments)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = 'acoustiq_yamnet_segments.csv'
    link.href = url
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleCopySummary() {
    if (segments.length === 0) return
    const stats = summarizeByCategory(segments)
    const lines: string[] = []
    lines.push('Classification audio YAMNet')
    lines.push(
      `Audio : ${bufferName ?? '—'}  ·  Segments : ${segments.length} ` +
        `(${segments.length} s analysés)`,
    )
    lines.push('')
    lines.push('Distribution par catégorie :')
    for (const s of stats) {
      const pct = (s.fraction * 100).toFixed(1)
      lines.push(`  ${s.category.padEnd(20)} ${s.seconds.toFixed(0).padStart(5)} s  (${pct} %)`)
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copie dans le presse-papiers refusée par le navigateur.')
    }
  }

  // ─── Statistiques (mémoïsées) ──────────────────────────────────────────
  const stats = useMemo(() => summarizeByCategory(segments), [segments])
  const top3 = stats.slice(0, 3)

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-800 shrink-0">
        <Brain size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Classification audio (YAMNet)
        </span>
        <span className="text-[10px] text-gray-600">
          521 classes → 7 catégories AcoustiQ · 100 % client-side
        </span>
      </div>

      <div className="px-6 py-5 space-y-6 max-w-5xl">
        {/* ─── 1. Source audio ────────────────────────────────────────────── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            1 · Source audio
          </h3>
          {audioFile && !localBuffer ? (
            <div className="px-3 py-2 rounded border border-emerald-800/60 bg-emerald-950/20
                            text-xs text-emerald-300">
              Utilise le WAV chargé dans le projet :{' '}
              <span className="font-semibold">{audioFile.name}</span>{' '}
              <span className="text-gray-500">
                ({audioFile.duration.toFixed(0)} s, {audioFile.buffer.numberOfChannels} canal)
              </span>
            </div>
          ) : (
            <label
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg
                         border-2 border-dashed border-gray-700 bg-gray-900/40
                         cursor-pointer hover:border-gray-600 transition-colors"
            >
              <Upload size={14} className="text-gray-500" />
              <span className="text-xs text-gray-400">
                {bufferName ? bufferName : 'Charger un WAV (mono ou stéréo, n\'importe quel sample rate)'}
              </span>
              <input
                type="file"
                accept=".wav,audio/wav"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleLocalFile(f)
                  e.target.value = ''
                }}
              />
            </label>
          )}
          {bufferName && (
            <div className="text-[10px] text-gray-600 mt-1">
              {duration.toFixed(0)} s ·{' '}
              {tooLong ? (
                <span className="text-amber-400">
                  ⚠ &gt; 30 min — utilisez « Analyser une plage » ci-dessous
                </span>
              ) : (
                <span>~{Math.ceil(duration)} segments à classifier</span>
              )}
            </div>
          )}
        </section>

        {/* ─── 2. Plage / paramètres ──────────────────────────────────────── */}
        {buffer && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              2 · Étendue
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="range-mode"
                  checked={!useRange}
                  onChange={() => setUseRange(false)}
                  className="accent-emerald-500"
                />
                <span className="text-gray-300">Analyser tout</span>
              </label>
              <label className="flex items-center gap-1.5 ml-3">
                <input
                  type="radio"
                  name="range-mode"
                  checked={useRange}
                  onChange={() => setUseRange(true)}
                  className="accent-emerald-500"
                />
                <span className="text-gray-300">Analyser une plage</span>
              </label>
              {useRange && (
                <div className="flex items-center gap-1 ml-2">
                  <label className="text-[10px] text-gray-500">Début</label>
                  <input
                    type="text"
                    value={rangeStartMin}
                    onChange={(e) => setRangeStartMin(e.target.value)}
                    placeholder="HH:MM"
                    className="w-16 text-xs bg-gray-800 text-gray-100 border border-gray-700
                               rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <label className="text-[10px] text-gray-500 ml-1">Durée</label>
                  <input
                    type="number"
                    min="1"
                    value={rangeDurationMin}
                    onChange={(e) => setRangeDurationMin(e.target.value)}
                    className="w-16 text-xs bg-gray-800 text-gray-100 border border-gray-700
                               rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] text-gray-500">min</span>
                </div>
              )}
            </div>
            {tooLong && !useRange && (
              <div className="mt-2 px-2 py-1.5 rounded border border-amber-800/60 bg-amber-950/20
                              text-[11px] text-amber-300 flex items-start gap-2">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                Fichier &gt; 30 min : limitez l'analyse à une plage horaire pour
                éviter de bloquer le navigateur.
              </div>
            )}
          </section>
        )}

        {/* ─── 3. Lancer / progress ───────────────────────────────────────── */}
        {buffer && (
          <section>
            <div className="flex items-center gap-2">
              {phase === 'idle' || phase === 'done' || phase === 'error' ? (
                <button
                  onClick={handleRun}
                  disabled={!buffer}
                  className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold
                             bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40
                             transition-colors"
                >
                  <Play size={14} />
                  Lancer la classification
                </button>
              ) : (
                <button
                  onClick={handleAbort}
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium
                             bg-rose-700 text-white hover:bg-rose-600 transition-colors"
                >
                  <StopIcon size={14} />
                  Arrêter
                </button>
              )}
              {segments.length > 0 && (
                <button
                  onClick={handleClear}
                  className="px-2 py-1 rounded text-xs text-gray-500 hover:text-gray-200 hover:bg-gray-800
                             border border-gray-700 transition-colors"
                >
                  Effacer
                </button>
              )}
            </div>

            {(phase === 'loading-model' || phase === 'classifying') && (
              <div className="mt-3">
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                  <Loader2 size={12} className="animate-spin text-emerald-400" />
                  {phase === 'loading-model' ? (
                    <span>
                      Chargement du modèle IA, première utilisation ~10 s
                      <span className="text-gray-600"> (mis en cache navigateur ensuite)</span>
                    </span>
                  ) : (
                    <span>
                      Analyse en cours… <span className="text-gray-200 tabular-nums">{(progress * 100).toFixed(0)} %</span>
                      {etaSec !== null && etaSec > 0 && (
                        <span className="text-gray-600 ml-2">
                          · temps restant ~{formatMmSs(etaSec)}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-300"
                    style={{ width: `${(progress * 100).toFixed(0)}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="mt-3 px-3 py-2 rounded border border-rose-800/60 bg-rose-950/30
                              text-xs text-rose-300 flex items-start gap-2">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}
          </section>
        )}

        {/* ─── 4. Résultats ───────────────────────────────────────────────── */}
        {segments.length > 0 && (
          <>
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Légende des catégories
              </h3>
              <div className="flex flex-wrap gap-2">
                {ALL_CATEGORIES.map((c) => (
                  <span
                    key={c.category}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px]
                               bg-gray-900/60 border border-gray-800"
                  >
                    <i
                      className="inline-block w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="text-gray-300">{c.category}</span>
                  </span>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Distribution
              </h3>
              <div className="border border-gray-800 rounded overflow-hidden">
                <table className="w-full text-xs tabular-nums">
                  <thead className="bg-gray-900/60 text-gray-500">
                    <tr className="border-b border-gray-800">
                      <th className="text-left  px-3 py-1.5 font-medium">Catégorie</th>
                      <th className="text-right px-3 py-1.5 font-medium">Durée</th>
                      <th className="text-right px-3 py-1.5 font-medium">% du temps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((s) => (
                      <tr key={s.category} className="border-b border-gray-800/40">
                        <td className="px-3 py-1 flex items-center gap-2 text-gray-200">
                          <i
                            className="inline-block w-2.5 h-2.5 rounded-sm"
                            style={{ backgroundColor: s.color }}
                          />
                          {s.category}
                        </td>
                        <td className="px-3 py-1 text-right text-gray-300">
                          {formatMmSs(s.seconds)}
                          <span className="text-gray-600 text-[10px] ml-1">({s.seconds.toFixed(0)} s)</span>
                        </td>
                        <td className="px-3 py-1 text-right text-gray-300">
                          {(s.fraction * 100).toFixed(1)} %
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {top3.length > 0 && (
                <p className="text-[11px] text-gray-500 mt-2">
                  <strong className="text-gray-400">Top 3 :</strong>{' '}
                  {top3
                    .map((s) => `${s.category} (${(s.fraction * 100).toFixed(0)} %)`)
                    .join(' · ')}
                </p>
              )}
            </section>

            <section className="flex items-center gap-2">
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium
                           bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                           border border-gray-600 transition-colors"
              >
                <Download size={12} />
                Exporter CSV
              </button>
              <button
                onClick={handleCopySummary}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium
                           bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                           border border-gray-600 transition-colors"
                title="Copie un résumé formaté à coller dans le rapport"
              >
                <ClipboardCopy size={12} />
                {copied ? 'Copié ✓' : 'Copier résumé'}
              </button>
              <span className="text-[10px] text-gray-600 ml-2">
                Les segments sont aussi affichés en surimpression sur la courbe
                LAeq de l'onglet Analyse.
              </span>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
