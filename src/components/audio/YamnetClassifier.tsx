/**
 * YamnetClassifier — onglet « Audio IA ».
 *
 * Pipeline YAMNet (cf. utils/yamnetProcessor) avec mapping 521 → 7 catégories
 * acoustiques, segmentation configurable (durée + chevauchement), seuil de
 * confiance produisant des segments « incertains », backend TF.js forcé CPU.
 *
 * UI : paramètres, lancement + progression, légende 7 catégories, synthèse
 * (distribution + timeline empilée), tableau filtrable des segments, panneau
 * de diagnostic technique. Les segments sont publiés vers `App` via
 * `onSegmentsChange` pour l'overlay coloré sur `TimeSeriesChart`.
 */
import { useState, useRef, useMemo, useEffect } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  Brain,
  Upload,
  Play,
  Square as StopIcon,
  Download,
  ClipboardCopy,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Cpu,
} from 'lucide-react'
import {
  classifyAudio,
  segmentsToCSV,
  summarizeByCategory,
  getYamnetDiagnostics,
  DEFAULT_SEGMENT_DURATION,
  DEFAULT_THRESHOLD,
  type ClassifiedSegment,
} from '../../utils/yamnetProcessor'
import {
  CATEGORIES,
  CATEGORY_IDS,
  type CategoryId,
} from '../../data/yamnetCategories'
import type { AudioFile } from '../../types'

const MAX_SECONDS_FREE_RUN = 30 * 60 // 30 min
const OVERLAP_OPTIONS = [0, 25, 50, 75] as const
const SEGMENT_OPTIONS = [1, 2, 3, 5, 10] as const

type LogLevel = 'info' | 'warn' | 'error' | 'success'
interface LogEntry { level: LogLevel; msg: string; t: number }

interface Props {
  audioFile: AudioFile | null
  segments: ClassifiedSegment[]
  onSegmentsChange: (segments: ClassifiedSegment[]) => void
}

type Phase = 'idle' | 'loading-model' | 'classifying' | 'done' | 'error'
type CategoryFilter = 'all' | 'uncertain' | CategoryId

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
  // Paramètres d'analyse
  const [segmentDuration, setSegmentDuration] = useState<number>(DEFAULT_SEGMENT_DURATION)
  const [overlapPct, setOverlapPct] = useState<number>(0)
  const [thresholdPct, setThresholdPct] = useState<number>(DEFAULT_THRESHOLD * 100)
  // Exécution
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [diagOpen, setDiagOpen] = useState(false)
  const [filter, setFilter] = useState<CategoryFilter>('all')
  const abortRef = useRef<AbortController | null>(null)
  const startTimeRef = useRef<number>(0)
  const [etaSec, setEtaSec] = useState<number | null>(null)

  const buffer: AudioBuffer | null = localBuffer ?? audioFile?.buffer ?? null
  const bufferName: string | null = localName ?? audioFile?.name ?? null
  const duration = buffer?.duration ?? 0
  const tooLong = duration > MAX_SECONDS_FREE_RUN

  useEffect(() => {
    if (tooLong && !useRange) setUseRange(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tooLong])

  function addLog(level: LogLevel, msg: string) {
    setLogs((prev) => [...prev, { level, msg, t: Date.now() }])
  }

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
      setError('Décodage audio échoué : ' + String(err instanceof Error ? err.message : err))
    }
  }

  function parseHHMMtoSec(hhmm: string): number {
    const m = hhmm.match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return 0
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60
  }

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
    setLogs([])

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
        segmentDuration,
        overlap: overlapPct / 100,
        threshold: thresholdPct / 100,
        rangeStartSec,
        rangeDurationSec,
        signal: controller.signal,
        onLog: addLog,
        onModelLoading: () => setPhase('loading-model'),
        onModelReady: () => {
          setPhase('classifying')
          startTimeRef.current = performance.now()
        },
        onProgress: (p) => {
          setProgress(p)
          if (p > 0.02 && startTimeRef.current > 0) {
            const elapsedMs = performance.now() - startTimeRef.current
            setEtaSec(Math.max(0, Math.round(((elapsedMs / p) * (1 - p)) / 1000)))
          }
        },
      })
      onSegmentsChange(result)
      setPhase('done')
      setEtaSec(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      addLog('error', msg)
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
    const lines: string[] = []
    lines.push('Classification audio YAMNet (mapping 7 catégories acoustiques)')
    lines.push(`Audio : ${bufferName ?? '—'}  ·  Segments : ${segments.length}`)
    lines.push('')
    lines.push('Distribution par catégorie :')
    for (const s of stats) {
      lines.push(
        `  ${s.label.padEnd(22)} ${formatMmSs(s.seconds).padStart(8)}  (${(s.fraction * 100).toFixed(1)} %)`,
      )
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copie dans le presse-papiers refusée par le navigateur.')
    }
  }

  // ─── Données dérivées ──────────────────────────────────────────────────────
  const stats = useMemo(() => summarizeByCategory(segments), [segments])
  const top3Cats = stats.slice(0, 3)

  const filteredSegments = useMemo(() => {
    if (filter === 'all') return segments
    if (filter === 'uncertain') return segments.filter((s) => s.uncertain)
    return segments.filter((s) => !s.uncertain && s.dominantCat === filter)
  }, [segments, filter])

  // Données de la timeline empilée (un point par segment, % par catégorie).
  const timelineData = useMemo(() => {
    return segments.map((s) => {
      const row: Record<string, number> = { t: Math.round(s.timeStart) }
      for (const id of CATEGORY_IDS) row[id] = +(s.catScores[id] * 100).toFixed(1)
      return row
    })
  }, [segments])

  const diag = getYamnetDiagnostics()

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-800 shrink-0">
        <Brain size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Classification audio (YAMNet)
        </span>
        <span className="text-[10px] text-gray-600">
          521 classes → 7 catégories acoustiques · 100 % client-side · backend CPU
        </span>
      </div>

      <div className="px-6 py-5 space-y-6 max-w-5xl">
        {/* ─── 1. Source audio ────────────────────────────────────────────── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            1 · Source audio
          </h3>
          {audioFile && !localBuffer ? (
            <div className="px-3 py-2 rounded border border-emerald-800/60 bg-emerald-950/20 text-xs text-emerald-300">
              Utilise le fichier chargé dans le projet :{' '}
              <span className="font-semibold">{audioFile.name}</span>{' '}
              <span className="text-gray-500">
                ({audioFile.duration.toFixed(0)} s, {audioFile.buffer.numberOfChannels} canal)
              </span>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-gray-700 bg-gray-900/40 cursor-pointer hover:border-gray-600 transition-colors">
              <Upload size={14} className="text-gray-500" />
              <span className="text-xs text-gray-400">
                {bufferName ? bufferName : 'Charger un fichier audio (WAV/MP3/M4A…, mono ou stéréo)'}
              </span>
              <input
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.ogg"
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
              {duration.toFixed(0)} s{' '}
              {tooLong && (
                <span className="text-amber-400">
                  · &gt; 30 min — utilisez « Analyser une plage » ci-dessous
                </span>
              )}
            </div>
          )}
        </section>

        {/* ─── 2. Paramètres ───────────────────────────────────────────────── */}
        {buffer && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              2 · Paramètres d'analyse
            </h3>

            {/* Étendue */}
            <div className="flex items-center gap-2 text-xs flex-wrap">
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
                    className="w-16 text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <label className="text-[10px] text-gray-500 ml-1">Durée</label>
                  <input
                    type="number"
                    min="1"
                    value={rangeDurationMin}
                    onChange={(e) => setRangeDurationMin(e.target.value)}
                    className="w-16 text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] text-gray-500">min</span>
                </div>
              )}
            </div>

            {/* Segmentation + seuil */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Param label={`Durée de segment : ${segmentDuration} s`}>
                <div className="flex gap-1">
                  {SEGMENT_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSegmentDuration(s)}
                      className={`px-2 py-1 rounded text-xs border transition-colors ${
                        segmentDuration === s
                          ? 'bg-gray-100 text-gray-900 border-gray-100'
                          : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'
                      }`}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
              </Param>
              <Param label={`Chevauchement : ${overlapPct} %`}>
                <div className="flex gap-1">
                  {OVERLAP_OPTIONS.map((o) => (
                    <button
                      key={o}
                      onClick={() => setOverlapPct(o)}
                      className={`px-2 py-1 rounded text-xs border transition-colors ${
                        overlapPct === o
                          ? 'bg-gray-100 text-gray-900 border-gray-100'
                          : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'
                      }`}
                    >
                      {o}%
                    </button>
                  ))}
                </div>
              </Param>
              <Param label={`Seuil de confiance : ${thresholdPct} %`}>
                <input
                  type="range"
                  min={0}
                  max={80}
                  step={5}
                  value={thresholdPct}
                  onChange={(e) => setThresholdPct(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
                <div className="text-[10px] text-gray-600">
                  Sous ce seuil, le segment est marqué « incertain ».
                </div>
              </Param>
            </div>
          </section>
        )}

        {/* ─── 3. Lancer / progression ─────────────────────────────────────── */}
        {buffer && (
          <section>
            <div className="flex items-center gap-2">
              {phase === 'idle' || phase === 'done' || phase === 'error' ? (
                <button
                  onClick={handleRun}
                  disabled={!buffer}
                  className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors"
                >
                  <Play size={14} />
                  Lancer la classification
                </button>
              ) : (
                <button
                  onClick={handleAbort}
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-rose-700 text-white hover:bg-rose-600 transition-colors"
                >
                  <StopIcon size={14} />
                  Arrêter
                </button>
              )}
              {segments.length > 0 && (
                <button
                  onClick={handleClear}
                  className="px-2 py-1 rounded text-xs text-gray-500 hover:text-gray-200 hover:bg-gray-800 border border-gray-700 transition-colors"
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
                      Analyse en cours…{' '}
                      <span className="text-gray-200 tabular-nums">{(progress * 100).toFixed(0)} %</span>
                      {etaSec !== null && etaSec > 0 && (
                        <span className="text-gray-600 ml-2">· temps restant ~{formatMmSs(etaSec)}</span>
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
              <div className="mt-3 px-3 py-2 rounded border border-rose-800/60 bg-rose-950/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}
          </section>
        )}

        {/* ─── 4. Résultats ───────────────────────────────────────────────── */}
        {segments.length > 0 && (
          <>
            {/* Légende */}
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Catégories acoustiques
              </h3>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_IDS.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] bg-gray-900/60 border border-gray-800"
                  >
                    <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CATEGORIES[id].color }} />
                    <span className="text-gray-300">{CATEGORIES[id].name}</span>
                  </span>
                ))}
              </div>
            </section>

            {/* Distribution + timeline */}
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Synthèse globale
              </h3>
              <div className="border border-gray-800 rounded overflow-hidden">
                <table className="w-full text-xs tabular-nums">
                  <thead className="bg-gray-900/60 text-gray-500">
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-3 py-1.5 font-medium">Catégorie</th>
                      <th className="text-right px-3 py-1.5 font-medium">Durée</th>
                      <th className="text-right px-3 py-1.5 font-medium">% du temps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((s) => (
                      <tr key={s.key} className="border-b border-gray-800/40">
                        <td className="px-3 py-1 flex items-center gap-2 text-gray-200">
                          <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                          {s.label}
                        </td>
                        <td className="px-3 py-1 text-right text-gray-300">
                          {formatMmSs(s.seconds)}
                          <span className="text-gray-600 text-[10px] ml-1">({s.seconds.toFixed(0)} s)</span>
                        </td>
                        <td className="px-3 py-1 text-right text-gray-300">{(s.fraction * 100).toFixed(1)} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {top3Cats.length > 0 && (
                <p className="text-[11px] text-gray-500 mt-2">
                  <strong className="text-gray-400">Top 3 :</strong>{' '}
                  {top3Cats.map((s) => `${s.label} (${(s.fraction * 100).toFixed(0)} %)`).join(' · ')}
                </p>
              )}

              {/* Timeline empilée */}
              {timelineData.length > 1 && (
                <div className="mt-3 h-44 border border-gray-800 rounded bg-gray-900/40 p-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                      <XAxis
                        dataKey="t"
                        tickFormatter={(v) => formatMmSs(Number(v))}
                        tick={{ fontSize: 9, fill: '#6b7280' }}
                        stroke="#374151"
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 9, fill: '#6b7280' }}
                        stroke="#374151"
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 11 }}
                        labelFormatter={(v) => `t = ${formatMmSs(Number(v))}`}
                        formatter={(value, name) => [
                          `${value} %`,
                          CATEGORIES[String(name) as CategoryId]?.short ?? String(name),
                        ]}
                      />
                      {CATEGORY_IDS.map((id) => (
                        <Area
                          key={id}
                          type="monotone"
                          dataKey={id}
                          stackId="cat"
                          stroke={CATEGORIES[id].color}
                          fill={CATEGORIES[id].color}
                          fillOpacity={0.8}
                          isAnimationActive={false}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* Tableau filtrable des segments */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Segments ({filteredSegments.length})
                </h3>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as CategoryFilter)}
                  className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="all">Toutes catégories</option>
                  {CATEGORY_IDS.map((id) => (
                    <option key={id} value={id}>{CATEGORIES[id].name}</option>
                  ))}
                  <option value="uncertain">Segments incertains</option>
                </select>
              </div>
              <div className="border border-gray-800 rounded overflow-auto max-h-[360px]">
                <table className="w-full text-xs tabular-nums">
                  <thead className="bg-gray-900 sticky top-0 text-gray-500">
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-2 py-1.5 font-medium">#</th>
                      <th className="text-left px-2 py-1.5 font-medium">Début</th>
                      <th className="text-left px-2 py-1.5 font-medium">Fin</th>
                      <th className="text-left px-2 py-1.5 font-medium">Catégorie dominante</th>
                      <th className="text-right px-2 py-1.5 font-medium">Score</th>
                      <th className="text-left px-2 py-1.5 font-medium">Top-3 classes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSegments.map((s, i) => (
                      <tr key={i} className="border-b border-gray-800/40">
                        <td className="px-2 py-1 text-gray-500">{segments.indexOf(s) + 1}</td>
                        <td className="px-2 py-1 text-gray-400">{formatMmSs(s.timeStart)}</td>
                        <td className="px-2 py-1 text-gray-400">{formatMmSs(s.timeEnd)}</td>
                        <td className="px-2 py-1">
                          <span className="inline-flex items-center gap-1.5">
                            <i
                              className="inline-block w-2.5 h-2.5 rounded-sm"
                              style={{ backgroundColor: s.color }}
                            />
                            <span className={s.uncertain ? 'italic text-gray-500' : 'text-gray-200'}>
                              {s.uncertain ? 'incertain' : CATEGORIES[s.dominantCat].name}
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right text-gray-300">{(s.score * 100).toFixed(1)} %</td>
                        <td className="px-2 py-1 text-gray-500">
                          {s.top3.map((t) => `${t.name} (${(t.score * 100).toFixed(0)})`).join(' · ')}
                        </td>
                      </tr>
                    ))}
                    {filteredSegments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-2 py-4 text-center text-gray-500 italic">
                          Aucun segment pour ce filtre.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Exports */}
            <section className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100 border border-gray-600 transition-colors"
              >
                <Download size={12} /> Exporter CSV
              </button>
              <button
                onClick={handleCopySummary}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100 border border-gray-600 transition-colors"
                title="Copie un résumé formaté à coller dans le rapport"
              >
                <ClipboardCopy size={12} />
                {copied ? 'Copié ✓' : 'Copier résumé'}
              </button>
              <span className="text-[10px] text-gray-600 ml-2">
                Les segments sont aussi affichés en surimpression sur la courbe LAeq de l'onglet Analyse.
              </span>
            </section>
          </>
        )}

        {/* ─── Diagnostic technique (repliable) ────────────────────────────── */}
        {logs.length > 0 && (
          <section>
            <button
              onClick={() => setDiagOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              {diagOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Cpu size={12} className="text-gray-500" />
              Diagnostic technique ({logs.length} événements)
            </button>
            {diagOpen && (
              <div className="mt-2 space-y-2">
                <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Backend : <span className="text-gray-300">{diag.backend || '—'}</span></span>
                  <span>Modèle : <span className="text-gray-300 break-all">{diag.modelUrl || '—'}</span></span>
                  <span>Segments : <span className="text-gray-300">{segments.length}</span></span>
                </div>
                <div className="max-h-48 overflow-auto border border-gray-800 rounded bg-gray-950/60 p-2 space-y-0.5 font-mono text-[10px]">
                  {logs.map((l, i) => (
                    <div
                      key={i}
                      className={
                        l.level === 'error'
                          ? 'text-rose-400'
                          : l.level === 'warn'
                            ? 'text-amber-400'
                            : l.level === 'success'
                              ? 'text-emerald-400'
                              : 'text-gray-400'
                      }
                    >
                      {l.msg}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function Param({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-gray-400">{label}</div>
      {children}
    </div>
  )
}
