/**
 * Générateur de rapport structuré pour copier-coller dans Word
 * Sections éditables : en-tête, méthodologie, résultats, événements, concordance
 */
import { useState, useMemo, useEffect } from 'react'
import { Copy, Download, FileText, Check, Printer } from 'lucide-react'
import type { MeasurementFile, SourceEvent, ConcordanceState } from '../types'
import {
  laeqAvg,
  computeL10,
  computeL50,
  computeL90,
  computeLAFmax,
  computeLAFmin,
} from '../utils/acoustics'

interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  events: SourceEvent[]
  concordance: Record<string, ConcordanceState>
  selectedDate: string
  assignedPoints: string[]
}

function fmt(n: number): string {
  return n.toFixed(1)
}

export default function ReportGenerator({
  files,
  pointMap,
  events,
  concordance,
  selectedDate,
  assignedPoints,
}: Props) {
  const [projectName, setProjectName] = useState('Étude d\'impact acoustique')
  const [copied, setCopied] = useState(false)

  // Calcul des indices pour chaque point
  const indicesByPoint = useMemo(() => {
    return Object.fromEntries(
      assignedPoints.map((pt) => {
        const values = files
          .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
          .flatMap((f) => f.data)
          .map((dp) => dp.laeq)

        if (values.length === 0) return [pt, null]

        return [
          pt,
          {
            laeq: laeqAvg(values),
            l10: computeL10(values),
            l50: computeL50(values),
            l90: computeL90(values),
            lafmax: computeLAFmax(values),
            lafmin: computeLAFmin(values),
          },
        ]
      }),
    )
  }, [files, pointMap, selectedDate, assignedPoints])

  // Événements du jour
  const dayEvents = useMemo(
    () => events.filter((ev) => ev.day === selectedDate),
    [events, selectedDate],
  )

  // Sections éditables
  const [headerText, setHeaderText] = useState('')
  const [methodText, setMethodText] = useState('')
  const [resultsText, setResultsText] = useState('')
  const [eventsText, setEventsText] = useState('')
  const [concordanceText, setConcordanceText] = useState('')

  // Regénérer les sections quand les données changent (useEffect, pas useMemo)
  useEffect(() => {
    const points = assignedPoints.join(', ') || 'Aucun point assigné'
    setHeaderText(
      `${projectName}\n` +
      `Date de mesure : ${selectedDate || 'Non définie'}\n` +
      `Points de mesure : ${points}\n` +
      `Nombre de fichiers : ${files.filter((f) => !!pointMap[f.id]).length}`
    )

    setMethodText(
      `Les mesures acoustiques ont été réalisées à l'aide de sonomètres intégrateurs de classe 1 ` +
      `(modèles Larson Davis 831C / 821SE SoundExpert) conformément aux normes NF S 31-010 et ` +
      `NF S 31-110. L'appareil a été positionné à 1,50 m du sol, à au moins 2 m de toute surface ` +
      `réfléchissante. Les niveaux sonores LAeq ont été enregistrés par pas de 1 seconde. ` +
      `Les indices statistiques (L10, L50, L90) ainsi que les niveaux extrêmes (LAFmax, LAFmin) ` +
      `ont été calculés sur la période de mesure complète. Les spectres en tiers d'octave (6,3 Hz ` +
      `à 20 kHz) ont été enregistrés simultanément pour permettre l'analyse fréquentielle.`
    )

    const header = 'Point'.padEnd(12) + 'LAeq'.padStart(8) + 'L10'.padStart(8) +
      'L50'.padStart(8) + 'L90'.padStart(8) + 'LAFmax'.padStart(8) + 'LAFmin'.padStart(8)
    const separator = '-'.repeat(header.length)
    const rows = assignedPoints.map((pt) => {
      const v = indicesByPoint[pt]
      if (!v) return pt.padEnd(12) + '—'.padStart(8).repeat(6)
      return pt.padEnd(12) +
        fmt(v.laeq).padStart(8) +
        fmt(v.l10).padStart(8) +
        fmt(v.l50).padStart(8) +
        fmt(v.l90).padStart(8) +
        fmt(v.lafmax).padStart(8) +
        fmt(v.lafmin).padStart(8)
    })
    setResultsText(
      `Tableau des indices acoustiques (en dB(A)) :\n\n` +
      `${header}\n${separator}\n${rows.join('\n')}\n\n` +
      `Tous les niveaux sont exprimés en dB(A) ref. 20 µPa.`
    )

    if (dayEvents.length > 0) {
      const evList = dayEvents.map((ev) => `  - ${ev.time} : ${ev.label}`).join('\n')
      setEventsText(
        `${dayEvents.length} événement(s) source identifié(s) le ${selectedDate} :\n\n${evList}`
      )
    } else {
      setEventsText('Aucun événement source identifié pour cette journée.')
    }

    if (dayEvents.length > 0 && assignedPoints.length > 0) {
      const lines: string[] = []
      for (const ev of dayEvents) {
        const states: string[] = []
        for (const pt of assignedPoints) {
          const key = `${ev.id}|${pt}`
          const state = concordance[key] ?? 'Non visible'
          states.push(`${pt}: ${state}`)
        }
        lines.push(`  ${ev.time} — ${ev.label}\n    ${states.join(' | ')}`)
      }
      setConcordanceText(
        `Concordance événements / points de mesure :\n\n${lines.join('\n\n')}`
      )
    } else {
      setConcordanceText('Aucune donnée de concordance disponible.')
    }
  }, [projectName, selectedDate, assignedPoints, files, pointMap, indicesByPoint, dayEvents, concordance])

  function getFullReport(): string {
    return [
      '═'.repeat(60),
      headerText,
      '═'.repeat(60),
      '',
      '1. MÉTHODOLOGIE',
      '─'.repeat(40),
      methodText,
      '',
      '2. RÉSULTATS',
      '─'.repeat(40),
      resultsText,
      '',
      '3. ÉVÉNEMENTS SOURCES',
      '─'.repeat(40),
      eventsText,
      '',
      '4. CONCORDANCE',
      '─'.repeat(40),
      concordanceText,
      '',
      '═'.repeat(60),
      `Rapport généré le ${new Date().toLocaleDateString('fr-FR')} — AcoustiQ`,
      '═'.repeat(60),
    ].join('\n')
  }

  // Copier avec feedback visuel et gestion d'erreur
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(getFullReport())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback pour les navigateurs sans Clipboard API
      const textarea = document.createElement('textarea')
      textarea.value = getFullReport()
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function handleDownloadTxt() {
    const blob = new Blob([getFullReport()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = `acoustiq_rapport_${selectedDate || 'all'}.txt`
    link.href = url
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Barre de contrôle */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-800 shrink-0">
        <FileText size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Générateur de rapport
        </span>

        <div className="flex items-center gap-2 ml-4">
          <label className="text-xs text-gray-500">Projet :</label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                       px-2 py-1 w-64 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              copied
                ? 'bg-emerald-800 text-emerald-200'
                : 'bg-emerald-700 text-white hover:bg-emerald-600'
            }`}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copié !' : 'Copier le rapport'}
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium
                       bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                       border border-gray-600 transition-colors no-print"
          >
            <Printer size={12} />
            Imprimer / PDF
          </button>
          <button
            onClick={handleDownloadTxt}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium
                       bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                       border border-gray-600 transition-colors"
          >
            <Download size={12} />
            Exporter .txt
          </button>
        </div>
      </div>

      {/* Sections éditables */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <Section title="En-tête" value={headerText} onChange={setHeaderText} rows={4} />
        <Section title="1. Méthodologie" value={methodText} onChange={setMethodText} rows={6} />
        <Section title="2. Résultats" value={resultsText} onChange={setResultsText} rows={Math.max(6, assignedPoints.length + 6)} />
        <Section title="3. Événements sources" value={eventsText} onChange={setEventsText} rows={Math.max(3, dayEvents.length + 3)} />
        <Section title="4. Concordance" value={concordanceText} onChange={setConcordanceText} rows={Math.max(3, dayEvents.length * 3 + 2)} />
      </div>
    </div>
  )
}

function Section({
  title, value, onChange, rows,
}: {
  title: string; value: string; onChange: (v: string) => void; rows: number
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
        {title}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full text-xs font-mono bg-gray-900 text-gray-200 border border-gray-700
                   rounded-md px-3 py-2 resize-y
                   focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
      />
    </div>
  )
}
