/**
 * AudioCalagePanel — calage d'un fichier audio issu d'un enregistreur
 * externe (Tascam, Zoom…) sur l'axe temporel réel du sonomètre.
 *
 * Trois modes proposés :
 *   1. Horodatage direct     — date + heure saisies par l'utilisateur
 *   2. Pointage audio↔chart  — repère un événement à la fois dans l'audio
 *                               (bouton pendant la lecture) et sur le chart
 *                               (clic), le décalage est calculé
 *   3. Corrélation RMS       — décode l'audio, calcule l'enveloppe RMS par
 *                               seconde et cherche le meilleur offset par
 *                               corrélation de Pearson avec la courbe LAeq
 *
 * Le panneau reçoit :
 *   - l'entrée audio à caler
 *   - le hook useAudioSync (pour repérer la position audio et déclencher
 *     la lecture)
 *   - un callback pour "armer" le chart en mode pointage (le prochain clic
 *     sur le chart remonte la minute absolue à notre handler)
 *   - la série LAeq pour le mode 3 (récupérée côté App depuis `files`)
 */
import { useEffect, useMemo, useState } from 'react'
import { X, Clock, MousePointerClick, Activity, Loader2, Check, Target, Pencil } from 'lucide-react'
import type { AudioFileEntry } from '../../types'
import type { UseAudioSyncResult } from '../../hooks/useAudioSync'
import {
  decodeBlobUrl,
  computeRmsEnvelope,
  findBestOffset,
} from '../../utils/audioEnvelope'

export type CalageMode = 'direct' | 'pointing' | 'correlation'

interface Props {
  entry: AudioFileEntry
  sync: UseAudioSyncResult
  /** Série LAeq par seconde (aligné sur minutes depuis minuit du jour `entry.date`) */
  laeqByMinute: number[]
  /** Demande à l'App d'armer le chart pour capter le prochain clic (retourne la minute absolue). */
  onRequestChartPick: (cb: (tMin: number) => void) => void
  /** Annule une requête de pick en cours */
  onCancelChartPick: () => void
  /** Même chose pour une SÉLECTION DE PLAGE par drag (Auto RMS). */
  onRequestChartRangePick: (cb: (startMin: number, endMin: number) => void) => void
  onCancelChartRangePick: () => void
  /** Permet au panneau de mettre en évidence une fenêtre sur le chart. */
  onHighlightRange: (range: { startMin: number; endMin: number } | null) => void
  /** Applique un nouveau calage (met à jour startMin, date, caleStatus=calibrated) */
  onApply: (patch: { startMin: number; date: string }) => void
  onClose: () => void
}

function pad(n: number): string { return String(n).padStart(2, '0') }

function minToHHMMSS(m: number): string {
  const totalSec = Math.max(0, Math.round(m * 60))
  const h = Math.floor(totalSec / 3600)
  const mi = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${pad(h)}:${pad(mi)}:${pad(s)}`
}

function fmtOffset(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '−'
  const abs = Math.abs(Math.round(seconds))
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || h > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return `${sign}${parts.join(' ')}`
}

export default function AudioCalagePanel({
  entry, sync, laeqByMinute,
  onRequestChartPick, onCancelChartPick,
  onRequestChartRangePick, onCancelChartRangePick,
  onHighlightRange,
  onApply, onClose,
}: Props) {
  const [mode, setMode] = useState<CalageMode>('pointing')
  /** Quand vrai, le modal se réduit en petit bandeau en haut-droite pour laisser
   *  voir le graphique. Déclenché par les boutons de sélection graphique. */
  const [minimized, setMinimized] = useState(false)

  // Mode 1 — horodatage direct
  const [m1Date, setM1Date] = useState(entry.date)
  const [m1Time, setM1Time] = useState(() => {
    const totalSec = Math.round(entry.startMin * 60)
    return `${pad(Math.floor(totalSec / 3600))}:${pad(Math.floor((totalSec % 3600) / 60))}:${pad(totalSec % 60)}`
  })

  // Mode 2 — pointage
  const [audioMarkerSec, setAudioMarkerSec] = useState<number | null>(null)
  const [chartMarkerMin, setChartMarkerMin] = useState<number | null>(null)
  const [waitingChartClick, setWaitingChartClick] = useState(false)

  // Mode 3 — corrélation
  const [m3WindowStart, setM3WindowStart] = useState('08:00')
  const [m3WindowEnd, setM3WindowEnd] = useState('18:00')
  const [m3Result, setM3Result] = useState<
    | { offsetSec: number; correlation: number; newStartMin: number }
    | null
  >(null)
  const [m3Loading, setM3Loading] = useState(false)
  const [m3Error, setM3Error] = useState<string | null>(null)
  /** Fenêtre sélectionnée graphiquement (mode 3). Si défini, cache les
   *  champs HH:MM manuels et pré-remplit la corrélation. */
  const [m3GraphicalRange, setM3GraphicalRange] = useState<{ startMin: number; endMin: number } | null>(null)
  /** Mode saisie manuelle explicitement déplié (masqué par défaut). */
  const [m3ManualMode, setM3ManualMode] = useState(false)
  /** En attente d'un drag sur le chart pour sélectionner la fenêtre mode 3 */
  const [waitingRangePick, setWaitingRangePick] = useState(false)

  useEffect(() => {
    return () => {
      // Cleanup si on ferme pendant un pick en attente
      if (waitingChartClick) onCancelChartPick()
      if (waitingRangePick) onCancelChartRangePick()
      onHighlightRange(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Durée audio pour caler les bornes de mode 1/2
  const durationMin = entry.durationSec / 60

  // ── Mode 1 — valider un horodatage direct ────────────────────────────
  function applyDirect() {
    const m = m1Time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
    if (!m) return
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10), s = m[3] ? parseInt(m[3], 10) : 0
    if (h > 23 || mi > 59 || s > 59) return
    const startMin = h * 60 + mi + s / 60
    onApply({ startMin, date: m1Date })
    onClose()
  }

  // ── Mode 2 — pointage ─────────────────────────────────────────────────
  const audioCurrentSec = sync.activeEntryId === entry.id && sync.currentMin !== null
    ? Math.max(0, (sync.currentMin - entry.startMin) * 60)
    : 0

  function markAudio() {
    if (sync.activeEntryId !== entry.id) {
      sync.playAt(entry.id, entry.startMin)
    }
    setAudioMarkerSec(audioCurrentSec)
  }

  function armChartPick() {
    setWaitingChartClick(true)
    setMinimized(true)
    onRequestChartPick((tMin) => {
      setChartMarkerMin(tMin)
      setWaitingChartClick(false)
      setMinimized(false)
    })
  }

  function armRangePick() {
    setWaitingRangePick(true)
    setMinimized(true)
    onRequestChartRangePick((s, e) => {
      const range = { startMin: Math.min(s, e), endMin: Math.max(s, e) }
      setM3GraphicalRange(range)
      setWaitingRangePick(false)
      setMinimized(false)
      onHighlightRange(range)
    })
  }

  function cancelRangePick() {
    onCancelChartRangePick()
    setWaitingRangePick(false)
    setMinimized(false)
  }

  function cancelPointPick() {
    onCancelChartPick()
    setWaitingChartClick(false)
    setMinimized(false)
  }

  const pointingOffsetSec = audioMarkerSec !== null && chartMarkerMin !== null
    ? chartMarkerMin * 60 - audioMarkerSec - entry.startMin * 60
    : null

  function applyPointing() {
    if (audioMarkerSec === null || chartMarkerMin === null) return
    // Le nouvel instant de début = chartMarker (minutes absolues) − audioMarker (secondes)
    const newStartMin = chartMarkerMin - audioMarkerSec / 60
    onApply({ startMin: newStartMin, date: entry.date })
    onClose()
  }

  // ── Mode 3 — corrélation RMS ─────────────────────────────────────────
  async function runCorrelation() {
    setM3Loading(true)
    setM3Error(null)
    setM3Result(null)
    try {
      // Priorité à la sélection graphique ; sinon on retombe sur la saisie
      // manuelle HH:MM si l'utilisateur l'a explicitement dépliée.
      let startMin: number
      let endMin: number
      if (m3GraphicalRange) {
        startMin = Math.floor(m3GraphicalRange.startMin)
        endMin = Math.ceil(m3GraphicalRange.endMin)
      } else {
        const startMatch = m3WindowStart.match(/^(\d{1,2}):(\d{2})$/)
        const endMatch = m3WindowEnd.match(/^(\d{1,2}):(\d{2})$/)
        if (!startMatch || !endMatch) throw new Error('Fenêtre invalide (format HH:MM attendu).')
        startMin = parseInt(startMatch[1], 10) * 60 + parseInt(startMatch[2], 10)
        endMin = parseInt(endMatch[1], 10) * 60 + parseInt(endMatch[2], 10)
      }
      if (endMin <= startMin) throw new Error('La fin doit être après le début.')
      const laeqSlice: number[] = []
      for (let m = startMin; m < endMin; m++) {
        const v = laeqByMinute[m]
        laeqSlice.push(Number.isFinite(v) ? v : 0)
      }
      if (laeqSlice.length < 10) throw new Error('Pas assez de données LAeq dans la fenêtre.')

      const audioBuffer = await decodeBlobUrl(entry.blobUrl)
      // Enveloppe par minute pour s'aligner naturellement sur laeqByMinute
      const env = computeRmsEnvelope(audioBuffer, 60)
      if (env.length < 2) throw new Error('Enveloppe audio trop courte.')

      // Cherche un offset entre -6 h et +6 h (décalage typique des
      // enregistreurs de terrain).
      const res = findBestOffset(
        env,
        laeqSlice,
        startMin * 60,     // on passe en secondes pour matcher l'unité d'env.tSec
        -6 * 3600,
        6 * 3600,
        60,                // pas de 1 min
      )
      if (!res) throw new Error('Aucune corrélation trouvée.')
      // L'offset trouvé correspond à : timeReel = timeAudio + offsetSec
      // donc newStartMin = (−offsetSec / 60)  en minutes depuis minuit
      const newStartMin = -res.offsetSec / 60
      setM3Result({ ...res, newStartMin })
    } catch (err) {
      setM3Error(err instanceof Error ? err.message : 'Échec de la corrélation.')
    } finally {
      setM3Loading(false)
    }
  }

  function applyCorrelation() {
    if (!m3Result) return
    onApply({ startMin: m3Result.newStartMin, date: entry.date })
    onClose()
  }

  const statusDot = useMemo(() => {
    if (entry.caleStatus === 'calibrated') return { color: 'bg-emerald-500', label: 'Calé' }
    if (entry.caleStatus === 'date_only') return { color: 'bg-amber-400', label: 'Date estimée, non calé' }
    return { color: 'bg-rose-500', label: 'Non calé (00:00 par défaut)' }
  }, [entry.caleStatus])

  // Mode minimisé : petit panneau flottant en haut-droite qui laisse la vue
  // sur le chart pour cliquer / glisser. Conserve l'état interne du modal.
  if (minimized) {
    const cancel = waitingRangePick
      ? cancelRangePick
      : waitingChartClick
      ? cancelPointPick
      : () => setMinimized(false)
    return (
      <div className="fixed top-4 right-4 z-50 w-[320px] bg-gray-900 border border-amber-600 rounded-lg shadow-2xl p-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusDot.color} animate-pulse`} />
          <span className="text-[11px] font-semibold text-gray-100">
            {waitingRangePick
              ? 'Sélection de la fenêtre Auto RMS'
              : waitingChartClick
              ? 'Marqueur courbe — cliquez sur le chart'
              : 'Calage — mode compact'}
          </span>
          <button
            onClick={() => setMinimized(false)}
            className="ml-auto text-gray-400 hover:text-gray-200"
            aria-label="Rouvrir le modal complet"
            title="Rouvrir le modal complet"
          >
            <Pencil size={12} />
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1 leading-snug">
          {waitingRangePick
            ? 'Cliquez-glissez sur le graphique LAeq pour définir la fenêtre.'
            : waitingChartClick
            ? 'Cliquez sur le graphique LAeq à l\'instant du même événement que le marqueur audio.'
            : `${entry.name}`}
        </p>
        <div className="mt-2 flex justify-end gap-1.5">
          <button
            onClick={cancel}
            className="text-[10px] text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded px-2 py-1"
          >
            Annuler
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[640px] max-w-[92vw] max-h-[88vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg shadow-2xl">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
          <span className={`w-2.5 h-2.5 rounded-full ${statusDot.color}`} title={statusDot.label} />
          <h2 className="text-sm font-semibold text-gray-100">Caler : <span className="font-mono text-gray-300">{entry.name}</span></h2>
          <span className="text-[10px] text-gray-500 ml-2">{statusDot.label}</span>
          <button
            onClick={onClose}
            className="ml-auto text-gray-500 hover:text-gray-200"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-3 text-[11px] text-gray-400">
          Durée : <span className="font-mono text-gray-300">{minToHHMMSS(durationMin)}</span> · Début actuel : <span className="font-mono text-gray-300">{entry.date} {minToHHMMSS(entry.startMin)}</span>
        </div>

        {/* Sélecteur de mode */}
        <div className="px-5 flex gap-1 border-b border-gray-800">
          {([
            { id: 'direct', label: 'Horodatage', icon: Clock },
            { id: 'pointing', label: 'Pointage', icon: MousePointerClick },
            { id: 'correlation', label: 'Auto RMS', icon: Activity },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium transition-colors border-b-2 -mb-px ${
                mode === id
                  ? 'text-emerald-300 border-emerald-500'
                  : 'text-gray-400 border-transparent hover:text-gray-200'
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        {/* Contenu selon mode */}
        <div className="px-5 py-4 space-y-3">
          {mode === 'direct' && (
            <>
              <p className="text-[11px] text-gray-400 leading-snug">
                Saisissez la date et l'heure exactes du début de l'enregistrement.
                Utile si vous les connaissez via une note manuscrite ou une capture
                d'écran de l'horloge de l'enregistreur.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-wide">
                  Date
                  <input
                    type="date"
                    value={m1Date}
                    onChange={(e) => setM1Date(e.target.value)}
                    className="mt-1 w-full text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </label>
                <label className="text-[10px] text-gray-500 uppercase tracking-wide">
                  Heure de début (HH:MM:SS)
                  <input
                    type="text"
                    value={m1Time}
                    onChange={(e) => setM1Time(e.target.value)}
                    placeholder="14:23:15"
                    className="mt-1 w-full text-xs font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </label>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={onClose}
                  className="text-[11px] bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded px-3 py-1.5"
                >
                  Annuler
                </button>
                <button
                  onClick={applyDirect}
                  className="text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white rounded px-3 py-1.5 flex items-center gap-1"
                >
                  <Check size={12} />
                  Appliquer
                </button>
              </div>
            </>
          )}

          {mode === 'pointing' && (
            <>
              <p className="text-[11px] text-gray-400 leading-snug">
                Lisez l'audio, repérez un événement clair (coup, sifflet, camion qui
                passe), placez un marqueur à l'instant t du fichier, puis cliquez
                sur le graphique LAeq au même instant réel. Le décalage est calculé
                automatiquement.
              </p>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (sync.activeEntryId === entry.id && sync.playing) sync.pause()
                      else sync.playAt(entry.id, audioMarkerSec !== null ? entry.startMin + audioMarkerSec / 60 : entry.startMin)
                    }}
                    className="text-[11px] bg-blue-600 hover:bg-blue-500 text-white rounded px-3 py-1.5"
                  >
                    {sync.activeEntryId === entry.id && sync.playing ? 'Pause' : 'Lire'}
                  </button>
                  <span className="text-[11px] text-gray-400 font-mono tabular-nums">
                    Position audio : {minToHHMMSS(audioCurrentSec / 60)}
                  </span>
                </div>

                <button
                  onClick={markAudio}
                  disabled={sync.activeEntryId !== entry.id}
                  className="w-full text-[11px] bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-100 rounded px-3 py-2 flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  ● Placer un marqueur dans l'audio
                  {audioMarkerSec !== null && (
                    <span className="ml-2 text-blue-300 font-mono">
                      {minToHHMMSS(audioMarkerSec / 60)}
                    </span>
                  )}
                </button>

                <button
                  onClick={armChartPick}
                  disabled={audioMarkerSec === null || waitingChartClick}
                  className={`w-full text-[11px] rounded px-3 py-2 flex items-center justify-center gap-1.5 transition-colors ${
                    waitingChartClick
                      ? 'bg-amber-900/60 border border-amber-600 text-amber-200 animate-pulse'
                      : 'bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-100 disabled:opacity-50'
                  }`}
                >
                  <MousePointerClick size={12} />
                  {waitingChartClick
                    ? 'En attente du clic sur le graphique…'
                    : 'Cliquer sur le graphique LAeq au même instant'}
                  {chartMarkerMin !== null && !waitingChartClick && (
                    <span className="ml-2 text-emerald-300 font-mono">
                      {minToHHMMSS(chartMarkerMin)}
                    </span>
                  )}
                </button>

                {pointingOffsetSec !== null && (
                  <div className="rounded-md border border-emerald-700/60 bg-emerald-950/30 p-3 text-[11px] text-emerald-200 space-y-0.5">
                    <div>
                      Décalage calculé : <span className="font-mono font-semibold">{fmtOffset(pointingOffsetSec)}</span>
                    </div>
                    <div className="text-emerald-400/70">
                      Nouveau début de fichier : {minToHHMMSS(chartMarkerMin! - audioMarkerSec! / 60)}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={onClose}
                  className="text-[11px] bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded px-3 py-1.5"
                >
                  Annuler
                </button>
                <button
                  onClick={applyPointing}
                  disabled={audioMarkerSec === null || chartMarkerMin === null}
                  className="text-[11px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded px-3 py-1.5 flex items-center gap-1"
                >
                  <Check size={12} />
                  Appliquer le décalage
                </button>
              </div>
            </>
          )}

          {mode === 'correlation' && (
            <>
              <p className="text-[11px] text-gray-400 leading-snug">
                Sélectionnez graphiquement la fenêtre de la courbe LAeq contenant
                un événement distinctif (pic, passage de camion…). L'algorithme
                calcule l'enveloppe RMS de l'audio et cherche l'offset qui
                maximise la corrélation avec la courbe LAeq sur cette fenêtre.
              </p>

              {/* Sélection graphique de la fenêtre */}
              <button
                onClick={armRangePick}
                disabled={waitingRangePick}
                className="w-full text-[11px] bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded px-3 py-2 flex items-center justify-center gap-1.5"
              >
                <Target size={12} />
                {m3GraphicalRange
                  ? 'Modifier la sélection'
                  : 'Sélectionner une fenêtre sur le graphique'}
              </button>

              {m3GraphicalRange && (
                <div className="rounded-md border border-blue-700/60 bg-blue-950/30 p-2.5 text-[11px] text-blue-200 space-y-0.5">
                  <div>
                    Fenêtre sélectionnée :{' '}
                    <span className="font-mono font-semibold">
                      {minToHHMMSS(m3GraphicalRange.startMin).slice(0, 5)}
                      {' → '}
                      {minToHHMMSS(m3GraphicalRange.endMin).slice(0, 5)}
                    </span>
                    {' '}
                    <span className="text-blue-300/80">
                      ({(() => {
                        const dur = Math.max(0, m3GraphicalRange.endMin - m3GraphicalRange.startMin)
                        const h = Math.floor(dur / 60)
                        const m = Math.round(dur % 60)
                        return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
                      })()})
                    </span>
                  </div>
                </div>
              )}

              {/* Saisie manuelle (optionnelle, masquée par défaut) */}
              {!m3ManualMode ? (
                <button
                  onClick={() => setM3ManualMode(true)}
                  className="text-[10px] text-gray-500 hover:text-gray-300 underline self-start"
                  type="button"
                >
                  <Pencil size={9} className="inline-block mr-1" />
                  Saisir les heures manuellement
                </button>
              ) : (
                <div className="rounded border border-gray-800 p-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] text-gray-500 uppercase tracking-wide">
                      Début fenêtre LAeq (HH:MM)
                      <input
                        type="text"
                        value={m3WindowStart}
                        onChange={(e) => { setM3WindowStart(e.target.value); setM3GraphicalRange(null); onHighlightRange(null) }}
                        className="mt-1 w-full text-xs font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="text-[10px] text-gray-500 uppercase tracking-wide">
                      Fin fenêtre LAeq (HH:MM)
                      <input
                        type="text"
                        value={m3WindowEnd}
                        onChange={(e) => { setM3WindowEnd(e.target.value); setM3GraphicalRange(null); onHighlightRange(null) }}
                        className="mt-1 w-full text-xs font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                  </div>
                  <button
                    onClick={() => setM3ManualMode(false)}
                    className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                    type="button"
                  >
                    Revenir à la sélection graphique
                  </button>
                </div>
              )}

              <button
                onClick={runCorrelation}
                disabled={m3Loading || (!m3GraphicalRange && !m3ManualMode)}
                className="w-full text-[11px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded px-3 py-2 flex items-center justify-center gap-1.5"
              >
                {m3Loading && <Loader2 size={12} className="animate-spin" />}
                {m3Loading ? 'Décodage + corrélation…' : 'Lancer la corrélation'}
              </button>

              <p className="text-[10px] text-amber-400/80 italic">
                ⚠ Le décodage d'un gros MP3 peut prendre plusieurs secondes et consommer
                beaucoup de RAM. Gardez la fenêtre raisonnable (≤ 3 h idéalement).
              </p>

              {m3Error && (
                <div className="rounded border border-rose-700/60 bg-rose-950/30 p-2 text-[11px] text-rose-200">
                  {m3Error}
                </div>
              )}

              {m3Result && (
                <div className="rounded-md border border-emerald-700/60 bg-emerald-950/30 p-3 text-[11px] text-emerald-200 space-y-0.5">
                  <div>
                    Meilleur calage trouvé à <span className="font-mono font-semibold">
                      {minToHHMMSS(m3Result.newStartMin)}
                    </span>
                  </div>
                  <div className="text-emerald-400/70">
                    Corrélation : {m3Result.correlation.toFixed(2)} · Décalage : {fmtOffset(m3Result.offsetSec)}
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={onClose}
                  className="text-[11px] bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded px-3 py-1.5"
                >
                  Annuler
                </button>
                <button
                  onClick={applyCorrelation}
                  disabled={!m3Result}
                  className="text-[11px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded px-3 py-1.5 flex items-center gap-1"
                >
                  <Check size={12} />
                  Accepter le calage proposé
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
