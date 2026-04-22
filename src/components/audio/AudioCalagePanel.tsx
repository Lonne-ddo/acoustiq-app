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
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Clock, MousePointerClick, Activity, Loader2, Check, Target, Pencil, AlertTriangle, Lightbulb, CalendarClock } from 'lucide-react'
import type { AudioFileEntry } from '../../types'
import type { UseAudioSyncResult } from '../../hooks/useAudioSync'
import {
  computePartialRmsEnvelope,
  findBestShiftPartial,
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
  /** Jours de mesure disponibles pour le point assigné — suggestions dans
   *  l'assistant « Je ne connais pas la date ». Trié chrono. */
  measurementDays?: Array<{ date: string; startMin: number; endMin: number }>
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
  onApply, measurementDays = [], onClose,
}: Props) {
  const [mode, setMode] = useState<CalageMode>('pointing')
  /** Ouvre l'éditeur inline de la date/heure de début. */
  const [editingStart, setEditingStart] = useState(false)
  /** Ouvre l'assistant « Je ne connais pas la date ». */
  const [showAssistant, setShowAssistant] = useState(false)
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
  const [m3Progress, setM3Progress] = useState(0)
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

  // Escape : si un pick est en cours on l'annule, sinon on ferme le modal.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== 'Escape') return
      if (waitingRangePick) {
        ev.preventDefault()
        onCancelChartRangePick()
        setWaitingRangePick(false)
        setMinimized(false)
        return
      }
      if (waitingChartClick) {
        ev.preventDefault()
        onCancelChartPick()
        setWaitingChartClick(false)
        setMinimized(false)
        return
      }
      if (minimized) {
        ev.preventDefault()
        setMinimized(false)
        return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [waitingRangePick, waitingChartClick, minimized, onCancelChartRangePick, onCancelChartPick])

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
      // Auto-apply si les 2 marqueurs sont posés — la solution la plus
      // légère : ni décodage ni calcul, juste 2 timestamps. L'utilisateur
      // voit le résumé dans le modal pendant la fermeture.
      if (audioMarkerSec !== null) {
        const newStartMin = tMin - audioMarkerSec / 60
        onApply({ startMin: newStartMin, date: entry.date })
        onClose()
      }
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

  // ── Mode 3 — corrélation RMS sur décodage PARTIEL ───────────────────
  // Ne décode JAMAIS le fichier entier (essentiel pour les MP3 > 1h).
  // Lit en streaming via HTMLAudioElement + AnalyserNode une fenêtre
  // autour de la position attendue, puis corrèle à la courbe LAeq.
  const cancelRef = useRef({ cancelled: false })
  async function runCorrelation() {
    setM3Loading(true)
    setM3Progress(0)
    setM3Error(null)
    setM3Result(null)
    cancelRef.current = { cancelled: false }
    try {
      let laeqStartMin: number
      let laeqEndMin: number
      if (m3GraphicalRange) {
        laeqStartMin = Math.floor(m3GraphicalRange.startMin)
        laeqEndMin = Math.ceil(m3GraphicalRange.endMin)
      } else {
        const startMatch = m3WindowStart.match(/^(\d{1,2}):(\d{2})$/)
        const endMatch = m3WindowEnd.match(/^(\d{1,2}):(\d{2})$/)
        if (!startMatch || !endMatch) throw new Error('Fenêtre invalide (format HH:MM attendu).')
        laeqStartMin = parseInt(startMatch[1], 10) * 60 + parseInt(startMatch[2], 10)
        laeqEndMin = parseInt(endMatch[1], 10) * 60 + parseInt(endMatch[2], 10)
      }
      if (laeqEndMin <= laeqStartMin) throw new Error('La fin doit être après le début.')
      if (laeqEndMin - laeqStartMin > 60) {
        throw new Error(
          'La fenêtre est trop large pour l\'analyse automatique. Réduisez-la à moins d\'1h ou utilisez le mode Pointage.',
        )
      }

      const laeqPerMin: number[] = []
      for (let m = laeqStartMin; m < laeqEndMin; m++) {
        const v = laeqByMinute[m]
        laeqPerMin.push(Number.isFinite(v) ? v : 0)
      }
      if (laeqPerMin.length < 5) throw new Error('Pas assez de données LAeq dans la fenêtre.')

      // Fenêtre audio à décoder : autour de la position prédite par la
      // startMin actuelle (souvent 0 = midnight), avec ±30 min de marge
      // pour absorber le décalage réel.
      const currentStartSec = entry.startMin * 60
      const laeqStartSec = laeqStartMin * 60
      const laeqEndSec = laeqEndMin * 60
      const MARGIN = 30 * 60 // secondes — marge de recherche autour de la position attendue

      // Validation de plausibilité avec tolérance ±12 h entre la date du
      // fichier audio et la fenêtre LAeq choisie. Si on est strictement
      // hors, c'est que l'utilisateur a probablement importé un fichier
      // dont la date parsée du nom est fausse.
      const audioCenterSec = (laeqStartSec + laeqEndSec) / 2 - currentStartSec
      const TOLERANCE_SEC = 12 * 3600
      if (audioCenterSec < -TOLERANCE_SEC || audioCenterSec > entry.durationSec + TOLERANCE_SEC) {
        const laeqLabel = (() => {
          const totalMin = Math.floor((laeqStartSec + laeqEndSec) / 120)
          const h = Math.floor(totalMin / 60) % 24
          const m = totalMin % 60
          return `${entry.date.replace(/T.+/, '')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        })()
        // Erreur spéciale : on ajoute un tag pour afficher le bouton « Corriger la date »
        throw new Error(
          `__DATE_MISMATCH__La fenêtre LAeq choisie (${laeqLabel}) ne peut pas correspondre au fichier audio dont la date de début est ${entry.date} ${minToHHMMSS(entry.startMin).slice(0, 5)}.\n\nCorrigez la date du fichier pour qu'elle colle à votre mesure, puis relancez la corrélation.`,
        )
      }

      const audioWindowStart = Math.max(0, (laeqStartSec - currentStartSec) - MARGIN)
      const audioWindowEnd = Math.min(entry.durationSec, (laeqEndSec - currentStartSec) + MARGIN)
      if (audioWindowEnd - audioWindowStart < 60) {
        throw new Error(
          '__DATE_MISMATCH__La fenêtre LAeq choisie tombe hors de la plage audio disponible. Corrigez la date du fichier (le début actuel est ' +
          `${entry.date} ${minToHHMMSS(entry.startMin).slice(0, 5)}) ou déplacez la fenêtre sur le graphique.`,
        )
      }

      const { env, audioStartSec } = await computePartialRmsEnvelope(
        entry.blobUrl,
        audioWindowStart,
        audioWindowEnd,
        {
          onProgress: (p) => setM3Progress(p),
          signal: cancelRef.current,
        },
      )
      if (env.length < 2) throw new Error('Enveloppe audio trop courte.')

      // Recherche d'un shift dans la marge ±30 min (le 1er ordre de
      // décalage ; si aucune corrélation, l'utilisateur élargit la
      // fenêtre graphique ou recale grossièrement au préalable).
      const res = findBestShiftPartial(
        env,
        audioStartSec,
        laeqPerMin,
        laeqStartMin,
        laeqEndMin,
        currentStartSec,
        -MARGIN,
        MARGIN,
        60,
      )
      if (!res) throw new Error('Aucune corrélation trouvée dans la fenêtre de recherche.')
      const newStartMin = (currentStartSec + res.shiftSec) / 60
      setM3Result({ offsetSec: res.shiftSec, correlation: res.correlation, newStartMin })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Échec de la corrélation.'
      // Tip automatique quand c'est un échec de décodage : on suggère Pointage
      if (/décod|decode|Annulé/i.test(msg)) {
        setM3Error(
          msg + '\n\nCe fichier MP3 n\'a pas pu être analysé automatiquement. Essayez le mode Pointage qui ne nécessite pas de décodage.',
        )
      } else {
        setM3Error(msg)
      }
    } finally {
      setM3Loading(false)
    }
  }

  function cancelCorrelation() {
    cancelRef.current.cancelled = true
  }

  function applyCorrelation() {
    if (!m3Result) return
    onApply({ startMin: m3Result.newStartMin, date: entry.date })
    onClose()
  }

  const statusDot = useMemo(() => {
    if (entry.caleStatus === 'calibrated') return { color: 'bg-emerald-500', label: 'Calé' }
    if (entry.caleStatus === 'date_only') return { color: 'bg-amber-400', label: 'Date estimée, non calé' }
    if (entry.caleStatus === 'uncertain') return { color: 'bg-orange-500', label: 'Date estimée non fiable — à vérifier' }
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

        {/* Ligne info : durée + début actuel éditable en un clic. */}
        <div className="px-5 py-3 text-[11px] text-gray-400 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span>Durée :&nbsp;<span className="font-mono text-gray-300">{minToHHMMSS(durationMin)}</span></span>
          <span>·</span>
          <span className="flex items-center gap-1">
            Début actuel :
            {editingStart ? (
              <input
                autoFocus
                type="datetime-local"
                step="1"
                defaultValue={`${entry.date}T${minToHHMMSS(entry.startMin)}`}
                onBlur={(e) => {
                  const v = e.currentTarget.value
                  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
                  if (m) {
                    const [, dateISO, hh, mi, ss] = m
                    const startMin = parseInt(hh, 10) * 60 + parseInt(mi, 10) + (ss ? parseInt(ss, 10) / 60 : 0)
                    onApply({ startMin, date: dateISO })
                  }
                  setEditingStart(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setEditingStart(false)
                }}
                className="text-[11px] font-mono bg-gray-800 text-gray-100 border border-emerald-600 rounded px-1.5 py-0.5"
              />
            ) : (
              <button
                onClick={() => setEditingStart(true)}
                className="font-mono text-gray-200 hover:text-emerald-300 underline decoration-dotted decoration-gray-600 hover:decoration-emerald-500"
                title="Cliquez pour modifier la date/heure de début"
              >
                {entry.date} {minToHHMMSS(entry.startMin)}
              </button>
            )}
          </span>
          {!editingStart && (
            <button
              onClick={() => setShowAssistant(true)}
              className="ml-auto flex items-center gap-1 text-[10px] text-amber-300 hover:text-amber-200 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-800/60 rounded px-2 py-0.5"
              title="Ouvrir l'assistant pour définir la date à partir du projet"
            >
              <Lightbulb size={10} />
              Je ne connais pas la date
            </button>
          )}
        </div>

        {/* Bannière : date incertaine → recommander le mode Pointage */}
        {entry.caleStatus === 'uncertain' && !editingStart && (
          <div className="mx-5 mb-2 flex items-start gap-2 rounded border border-orange-700/60 bg-orange-950/30 p-2">
            <AlertTriangle size={14} className="text-orange-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-[11px] text-orange-200 leading-snug">
              Date du fichier <span className="font-semibold">incertaine</span> — le nom
              ressemble à <span className="font-mono">YYMMDD_NNNN</span> qui peut n'être
              qu'un numéro de session de l'enregistreur. Le mode Pointage est
              recommandé : il ne nécessite pas de connaître la date à l'avance.
            </div>
            <button
              onClick={() => setMode('pointing')}
              className="text-[11px] bg-orange-600 hover:bg-orange-500 text-white rounded px-2 py-1 shrink-0"
            >
              Utiliser Pointage
            </button>
          </div>
        )}

        {/* Assistant : « Je ne connais pas la date » */}
        {showAssistant && (
          <div className="mx-5 mb-2 rounded border border-amber-700/60 bg-amber-950/20 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-200">
              <Lightbulb size={12} />
              Quand cet enregistrement a-t-il été réalisé ?
            </div>
            <div className="space-y-1">
              {measurementDays.map((d) => (
                <button
                  key={d.date}
                  onClick={() => {
                    onApply({ date: d.date, startMin: d.startMin })
                    setShowAssistant(false)
                  }}
                  className="w-full text-left flex items-center gap-2 text-[11px] bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-emerald-700/60 rounded px-2 py-1.5 text-gray-200"
                >
                  <CalendarClock size={11} className="text-emerald-400 shrink-0" />
                  <span>
                    Pendant la mesure du{' '}
                    <span className="font-mono text-gray-100">{d.date}</span>
                    {' '}
                    (<span className="font-mono text-gray-400">
                      {String(Math.floor(d.startMin / 60)).padStart(2, '0')}:
                      {String(Math.round(d.startMin % 60)).padStart(2, '0')}
                      {' → '}
                      {String(Math.floor(d.endMin / 60)).padStart(2, '0')}:
                      {String(Math.round(d.endMin % 60)).padStart(2, '0')}
                    </span>)
                  </span>
                </button>
              ))}
              {measurementDays.length === 0 && (
                <p className="text-[10px] text-gray-500 italic">
                  Aucun fichier de mesure importé pour ce point.
                </p>
              )}
              <button
                onClick={() => { setShowAssistant(false); setEditingStart(true) }}
                className="w-full text-left text-[11px] bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded px-2 py-1.5 text-gray-300"
              >
                Saisir une date/heure précise…
              </button>
              <button
                onClick={() => { setShowAssistant(false); setMode('pointing') }}
                className="w-full text-left text-[11px] bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded px-2 py-1.5 text-gray-300"
              >
                Je ne sais vraiment pas → utiliser <span className="text-orange-300 font-semibold">Pointage</span> (plus robuste)
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setShowAssistant(false)}
                className="text-[10px] text-gray-500 hover:text-gray-300 underline"
              >
                Fermer l'assistant
              </button>
            </div>
          </div>
        )}

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

              {!m3Loading ? (
                <button
                  onClick={runCorrelation}
                  disabled={
                    !m3GraphicalRange && !m3ManualMode
                    /* Validation de la fenêtre 1h dans runCorrelation */
                  }
                  className="w-full text-[11px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded px-3 py-2 flex items-center justify-center gap-1.5"
                >
                  Lancer la corrélation
                </button>
              ) : (
                <div className="rounded border border-blue-700/60 bg-blue-950/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-[11px] text-blue-200">
                    <Loader2 size={12} className="animate-spin" />
                    <span>Analyse de l'audio sur la fenêtre sélectionnée…</span>
                    <span className="ml-auto font-mono text-blue-300 tabular-nums">
                      {Math.round(m3Progress * 100)} %
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-900 rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-100"
                      style={{ width: `${Math.max(0, Math.min(1, m3Progress)) * 100}%` }}
                    />
                  </div>
                  <button
                    onClick={cancelCorrelation}
                    className="text-[10px] text-gray-300 hover:text-gray-100 underline"
                    type="button"
                  >
                    Annuler l'analyse
                  </button>
                </div>
              )}

              {m3GraphicalRange && (m3GraphicalRange.endMin - m3GraphicalRange.startMin > 60) && (
                <p className="text-[10px] text-rose-300 bg-rose-950/30 border border-rose-800/60 rounded px-2 py-1.5">
                  La fenêtre est trop large pour l'analyse automatique (max 1h).
                  Réduisez-la ou utilisez le mode <span className="font-semibold">Pointage</span>.
                </p>
              )}

              <p className="text-[10px] text-gray-500 italic leading-snug">
                Décodage partiel via HTMLAudioElement + AnalyserNode (streaming, pas
                de chargement complet en mémoire). Fonctionne sur les MP3 de
                plusieurs heures si la fenêtre reste ≤ 1h.
              </p>

              {m3Error && (() => {
                const isDateMismatch = m3Error.startsWith('__DATE_MISMATCH__')
                const displayMsg = isDateMismatch ? m3Error.replace('__DATE_MISMATCH__', '') : m3Error
                return (
                  <div className="rounded border border-rose-700/60 bg-rose-950/30 p-2.5 text-[11px] text-rose-200 whitespace-pre-line space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={13} className="shrink-0 text-rose-400 mt-0.5" />
                      <span className="flex-1">{displayMsg}</span>
                    </div>
                    {isDateMismatch && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button
                          onClick={() => { setM3Error(null); setEditingStart(true) }}
                          className="text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded px-2 py-1 flex items-center gap-1"
                        >
                          <Pencil size={10} />
                          Corriger la date du fichier
                        </button>
                        <button
                          onClick={() => { setM3Error(null); setMode('pointing') }}
                          className="text-[11px] bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 rounded px-2 py-1"
                        >
                          Utiliser Pointage
                        </button>
                      </div>
                    )}
                  </div>
                )
              })()}

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
