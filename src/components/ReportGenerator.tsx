/**
 * Générateur de rapport structuré pour copier-coller dans Word
 *
 * Sections auto-remplies depuis les données chargées (en-tête, méthodologie,
 * indices, conformité, concordance) et restent éditables manuellement. Chaque
 * section dispose d'un bouton « Rafraîchir depuis les données » qui réinjecte
 * la valeur générée à partir de l'état courant. La regénération automatique
 * n'écrase pas une section que l'utilisateur a modifiée à la main.
 */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import JSZip from 'jszip'
import { Copy, Download, FileText, Check, Printer, RefreshCw, Image as ImageIcon } from 'lucide-react'
import {
  drawFigureCourbe,
  drawFigureSpectrogramme,
  drawFigureIndices,
  drawFigureConformite,
  canvasToPngBlob,
} from '../utils/reportFigures'
import type {
  MeasurementFile,
  SourceEvent,
  ConcordanceState,
  ConformiteSummary,
  MeteoData,
} from '../types'
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
  conformiteSummary: ConformiteSummary | null
  companyName: string
  meteo?: MeteoData
}

function fmt(n: number): string {
  return n.toFixed(1)
}

type SectionKey = 'header' | 'method' | 'meteo' | 'results' | 'conformite' | 'events' | 'concordance'

export default function ReportGenerator({
  files,
  pointMap,
  events,
  concordance,
  selectedDate,
  assignedPoints,
  conformiteSummary,
  companyName,
  meteo,
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

  // Dates couvertes par les fichiers assignés
  const measurementDates = useMemo(() => {
    const dates = new Set<string>()
    for (const f of files) {
      if (pointMap[f.id]) dates.add(f.date)
    }
    return [...dates].sort()
  }, [files, pointMap])

  // ──────────────────────────────────────────────────────────────────────────
  // Générateurs (purs) — chacun produit le texte d'une section
  // ──────────────────────────────────────────────────────────────────────────

  const generators = useMemo(() => {
    const points = assignedPoints.join(', ') || 'Aucun point assigné'
    const fileCount = files.filter((f) => !!pointMap[f.id]).length
    const dateRange =
      measurementDates.length === 0
        ? 'Non définie'
        : measurementDates.length === 1
        ? measurementDates[0]
        : `${measurementDates[0]} → ${measurementDates[measurementDates.length - 1]}`

    function header(): string {
      return (
        `${projectName}\n` +
        (companyName ? `${companyName}\n` : '') +
        `Date(s) de mesure : ${dateRange}\n` +
        `Date analysée : ${selectedDate || 'Non définie'}\n` +
        `Points de mesure : ${points} (${assignedPoints.length})\n` +
        `Nombre de fichiers : ${fileCount}`
      )
    }

    function meteoSection(): string {
      if (!meteo) return 'Aucune donnée météorologique saisie.'
      const lines: string[] = []
      if (meteo.windSpeed !== null) {
        const valid = meteo.windSpeed < 20
        lines.push(
          `Vent : ${meteo.windSpeed} km/h${meteo.windDirection ? ` (${meteo.windDirection})` : ''}` +
            (valid
              ? ' — ✓ Valide (critère MELCCFP 2026 : < 20 km/h)'
              : ' — ✗ Invalide (≥ 20 km/h — mesures potentiellement invalides selon les Lignes directrices MELCCFP 2026)'),
        )
      }
      if (meteo.temperature !== null) lines.push(`Température : ${meteo.temperature} °C`)
      if (meteo.conditions) lines.push(`Conditions : ${meteo.conditions}`)
      if (meteo.note.trim()) lines.push(`Note : ${meteo.note.trim()}`)
      if (lines.length === 0) return 'Aucune donnée météorologique saisie.'
      return lines.join('\n')
    }

    function method(): string {
      return (
        `Les mesures acoustiques ont été réalisées à l'aide de sonomètres intégrateurs ` +
        `de classe 1 conformément aux normes NF S 31-010 et NF S 31-110. ` +
        `Les appareils ont été positionnés à 1,50 m du sol, ` +
        `à au moins 2 m de toute surface réfléchissante. Les niveaux LAeq ont été ` +
        `enregistrés au pas de 1 seconde puis agrégés par paliers de 5 minutes pour ` +
        `l'affichage et l'analyse statistique. Les indices L10, L50, L90 ainsi que les ` +
        `niveaux extrêmes LAFmax / LAFmin sont calculés sur la période de mesure complète. ` +
        `Les spectres en tiers d'octave (6,3 Hz à 20 kHz) sont enregistrés en parallèle ` +
        `pour permettre l'analyse fréquentielle et l'évaluation des termes correctifs ` +
        `(Kt tonal, Kb basses fréquences, Ki impulsif) selon les Lignes directrices ` +
        `MELCCFP 2026.`
      )
    }

    function results(): string {
      const head =
        'Point'.padEnd(12) +
        'LAeq'.padStart(8) +
        'L10'.padStart(8) +
        'L50'.padStart(8) +
        'L90'.padStart(8) +
        'LAFmax'.padStart(8) +
        'LAFmin'.padStart(8)
      const separator = '-'.repeat(head.length)
      const rows = assignedPoints.map((pt) => {
        const v = indicesByPoint[pt]
        if (!v) return pt.padEnd(12) + '—'.padStart(8).repeat(6)
        return (
          pt.padEnd(12) +
          fmt(v.laeq).padStart(8) +
          fmt(v.l10).padStart(8) +
          fmt(v.l50).padStart(8) +
          fmt(v.l90).padStart(8) +
          fmt(v.lafmax).padStart(8) +
          fmt(v.lafmin).padStart(8)
        )
      })
      return (
        `Tableau des indices acoustiques (en dB(A)) — ${selectedDate || 'date non définie'} :\n\n` +
        `${head}\n${separator}\n${rows.join('\n')}\n\n` +
        `Tous les niveaux sont exprimés en dB(A) ref. 20 µPa.`
      )
    }

    function conformite(): string {
      if (!conformiteSummary || conformiteSummary.points.length === 0) {
        return (
          `Aucune évaluation de conformité disponible.\n` +
          `Ouvrez l'onglet « Conformité 2026 », sélectionnez le récepteur et l'heure ` +
          `d'évaluation pour générer cette section.`
        )
      }
      const cs = conformiteSummary
      const head =
        'Point'.padEnd(12) +
        'Ba'.padStart(8) +
        'Br'.padStart(8) +
        'Bp'.padStart(8) +
        'LAr,1h'.padStart(10) +
        'Crit.'.padStart(8) +
        '  Résultat'
      const separator = '-'.repeat(head.length + 12)
      const rows = cs.points.map((p) => {
        const ba = p.ba !== null ? fmt(p.ba) : '—'
        const br = p.br !== null ? fmt(p.br) : '—'
        const bp = p.bp !== null ? fmt(p.bp) : '—'
        const lar = p.lar !== null ? fmt(p.lar) : '—'
        const crit = fmt(p.criterion)
        const res =
          p.pass === null ? 'non évalué' : p.pass ? 'CONFORME' : 'NON CONFORME'
        return (
          p.point.padEnd(12) +
          ba.padStart(8) +
          br.padStart(8) +
          bp.padStart(8) +
          lar.padStart(10) +
          crit.padStart(8) +
          '  ' +
          res
        )
      })
      const passCount = cs.points.filter((p) => p.pass === true).length
      const failCount = cs.points.filter((p) => p.pass === false).length

      // Bloc incertitude (ISO 9613-2) — si publié par Conformité 2026
      let uncertaintyBlock = ''
      if (typeof cs.uncertainty === 'number') {
        const lines = cs.points
          .filter((p) => typeof p.larPlusU === 'number')
          .map((p) => {
            const flag = p.margeNonConforme
              ? '⚠ NON CONFORME avec marge'
              : '✓ CONFORME avec marge'
            return `  - ${p.point} : LAr,1h (${fmt(p.lar as number)}) + ±${fmt(cs.uncertainty as number)} = ${fmt(p.larPlusU as number)} dB(A) vs critère ${fmt(p.criterion)} dB(A) — ${flag}`
          })
        uncertaintyBlock =
          `\n\nIncertitude (ISO 9613-2)\n` +
          `Mesurage ± 1.0 dB (sonomètre classe 1) · Combinée ± ${fmt(cs.uncertainty)} dB\n` +
          lines.join('\n')
      }

      return (
        `Évaluation selon les Lignes directrices MELCCFP 2026 ` +
        `(en vigueur depuis le 13 janvier 2026).\n` +
        `Récepteur : ${cs.receptorLabel}\n` +
        `Période : ${cs.period === 'jour' ? 'Jour (7 h – 19 h)' : 'Nuit (19 h – 7 h)'}\n` +
        `Heure d'évaluation : ${cs.evalHour} → +1 h\n` +
        `Niveau maximal LAr,1h : ${cs.limit} dB(A)\n\n` +
        `${head}\n${separator}\n${rows.join('\n')}\n\n` +
        `Synthèse : ${passCount} point(s) conforme(s), ${failCount} non conforme(s) ` +
        `sur ${cs.points.length} évalué(s).` +
        uncertaintyBlock
      )
    }

    function eventsSection(): string {
      if (dayEvents.length === 0) {
        return 'Aucun événement source identifié pour cette journée.'
      }
      const evList = dayEvents
        .map((ev) => `  - ${ev.time} : ${ev.label}`)
        .join('\n')
      return `${dayEvents.length} événement(s) source identifié(s) le ${selectedDate} :\n\n${evList}`
    }

    function concordanceSection(): string {
      if (dayEvents.length === 0 || assignedPoints.length === 0) {
        return 'Aucune donnée de concordance disponible.'
      }
      // Classer chaque événement selon son état dominant
      const identified: SourceEvent[] = []
      const toVerify: SourceEvent[] = []
      const notVisible: SourceEvent[] = []
      for (const ev of dayEvents) {
        const states = assignedPoints.map(
          (pt) => concordance[`${ev.id}|${pt}`] ?? 'Non visible',
        )
        if (states.includes('Confirmé')) identified.push(ev)
        else if (states.includes('Incertain')) toVerify.push(ev)
        else notVisible.push(ev)
      }

      const lines: string[] = []

      lines.push(`Sources identifiées (Confirmé) — ${identified.length} :`)
      if (identified.length === 0) lines.push('  (aucune)')
      else
        for (const ev of identified) {
          const ptStates = assignedPoints
            .map((pt) => `${pt}: ${concordance[`${ev.id}|${pt}`] ?? 'Non visible'}`)
            .join(' | ')
          lines.push(`  - ${ev.time} ${ev.label}\n      ${ptStates}`)
        }

      lines.push('')
      lines.push(`À vérifier (Incertain) — ${toVerify.length} :`)
      if (toVerify.length === 0) lines.push('  (aucune)')
      else
        for (const ev of toVerify) {
          const ptStates = assignedPoints
            .map((pt) => `${pt}: ${concordance[`${ev.id}|${pt}`] ?? 'Non visible'}`)
            .join(' | ')
          lines.push(`  - ${ev.time} ${ev.label}\n      ${ptStates}`)
        }

      if (notVisible.length > 0) {
        lines.push('')
        lines.push(
          `Non détectés sur les points évalués — ${notVisible.length} : ` +
            notVisible.map((ev) => `${ev.time} ${ev.label}`).join(', '),
        )
      }

      return lines.join('\n')
    }

    return {
      header,
      method,
      meteo: meteoSection,
      results,
      conformite,
      events: eventsSection,
      concordance: concordanceSection,
    }
  }, [
    projectName,
    companyName,
    selectedDate,
    measurementDates,
    assignedPoints,
    files,
    pointMap,
    indicesByPoint,
    dayEvents,
    concordance,
    conformiteSummary,
    meteo,
  ])

  // Sections éditables + suivi de la "salissure" (édition manuelle)
  const [headerText, setHeaderText] = useState(() => generators.header())
  const [methodText, setMethodText] = useState(() => generators.method())
  const [meteoText, setMeteoText] = useState(() => generators.meteo())
  const [resultsText, setResultsText] = useState(() => generators.results())
  const [conformiteText, setConformiteText] = useState(() => generators.conformite())
  const [eventsText, setEventsText] = useState(() => generators.events())
  const [concordanceText, setConcordanceText] = useState(() => generators.concordance())

  /** Valeur générée la dernière fois — sert à détecter si l'utilisateur a édité. */
  const lastGeneratedRef = useRef<Record<SectionKey, string>>({
    header: generators.header(),
    method: generators.method(),
    meteo: generators.meteo(),
    results: generators.results(),
    conformite: generators.conformite(),
    events: generators.events(),
    concordance: generators.concordance(),
  })

  // Auto-rafraîchissement : si la section n'a pas été modifiée manuellement,
  // on la met à jour quand les données changent.
  useEffect(() => {
    const next = {
      header: generators.header(),
      method: generators.method(),
      meteo: generators.meteo(),
      results: generators.results(),
      conformite: generators.conformite(),
      events: generators.events(),
      concordance: generators.concordance(),
    }
    const last = lastGeneratedRef.current
    const setters: Record<SectionKey, [string, (v: string) => void]> = {
      header: [headerText, setHeaderText],
      method: [methodText, setMethodText],
      meteo: [meteoText, setMeteoText],
      results: [resultsText, setResultsText],
      conformite: [conformiteText, setConformiteText],
      events: [eventsText, setEventsText],
      concordance: [concordanceText, setConcordanceText],
    }
    for (const k of Object.keys(next) as SectionKey[]) {
      const [current, set] = setters[k]
      // Section non éditée par l'utilisateur (= identique à la dernière valeur générée)
      if (current === last[k]) set(next[k])
    }
    lastGeneratedRef.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generators])

  /** Bouton « Rafraîchir » : force la régénération de la section. */
  const refresh = useCallback(
    (key: SectionKey) => {
      const value = generators[key]()
      lastGeneratedRef.current = { ...lastGeneratedRef.current, [key]: value }
      switch (key) {
        case 'header': setHeaderText(value); break
        case 'method': setMethodText(value); break
        case 'meteo': setMeteoText(value); break
        case 'results': setResultsText(value); break
        case 'conformite': setConformiteText(value); break
        case 'events': setEventsText(value); break
        case 'concordance': setConcordanceText(value); break
      }
    },
    [generators],
  )

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
      '2. CONDITIONS MÉTÉOROLOGIQUES',
      '─'.repeat(40),
      meteoText,
      '',
      '3. RÉSULTATS',
      '─'.repeat(40),
      resultsText,
      '',
      '4. CONFORMITÉ 2026 (MELCCFP)',
      '─'.repeat(40),
      conformiteText,
      '',
      '5. ÉVÉNEMENTS SOURCES',
      '─'.repeat(40),
      eventsText,
      '',
      '6. CONCORDANCE',
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

  // ── Export figures ZIP ────────────────────────────────────────────────────
  const [exportingFigs, setExportingFigs] = useState(false)
  async function handleExportFigures() {
    setExportingFigs(true)
    try {
      const zip = new JSZip()
      let n = 1

      // Figure 1 — Courbe temporelle
      const figCourbe = drawFigureCourbe({
        files, pointMap, selectedDate, events,
        number: n,
      })
      zip.file(`figure_${String(n).padStart(2, '0')}_courbe_temporelle.png`, await canvasToPngBlob(figCourbe))
      n++

      // Figure 2 — Spectrogramme (par point disposant de spectres)
      const dataByPoint = new Map<string, MeasurementFile['data']>()
      for (const f of files) {
        const pt = pointMap[f.id]
        if (!pt || f.date !== selectedDate) continue
        const arr = dataByPoint.get(pt) ?? []
        arr.push(...f.data)
        dataByPoint.set(pt, arr)
      }
      for (const [pt, dps] of dataByPoint) {
        const figSpec = drawFigureSpectrogramme({
          pointName: pt, data: dps, selectedDate, number: n,
        })
        if (figSpec) {
          zip.file(
            `figure_${String(n).padStart(2, '0')}_spectrogramme_${pt}.png`,
            await canvasToPngBlob(figSpec),
          )
          n++
        }
      }

      // Figure 3 — Indices acoustiques
      const figIdx = drawFigureIndices({ files, pointMap, selectedDate, number: n })
      zip.file(`figure_${String(n).padStart(2, '0')}_indices.png`, await canvasToPngBlob(figIdx))
      n++

      // Figure 4 — Conformité 2026 (si données disponibles)
      if (conformiteSummary && conformiteSummary.points.length > 0) {
        const figConf = drawFigureConformite({ summary: conformiteSummary, number: n })
        zip.file(`figure_${String(n).padStart(2, '0')}_conformite_2026.png`, await canvasToPngBlob(figConf))
        n++
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `acoustiq_figures_${selectedDate || 'rapport'}.zip`
      link.href = url
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export figures échoué :', err)
      alert('Export figures échoué — voir la console pour les détails.')
    } finally {
      setExportingFigs(false)
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
            onClick={handleExportFigures}
            disabled={exportingFigs}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium
                       bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                       border border-gray-600 transition-colors disabled:opacity-50"
            title="Génère un ZIP de figures PNG prêtes pour le rapport (1200×600 px)"
          >
            <ImageIcon size={12} />
            {exportingFigs ? 'Export…' : 'Exporter figures'}
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
        <Section title="En-tête" value={headerText} onChange={setHeaderText} rows={5}
          onRefresh={() => refresh('header')} />
        <Section title="1. Méthodologie" value={methodText} onChange={setMethodText} rows={7}
          onRefresh={() => refresh('method')} />
        <Section title="2. Conditions météorologiques" value={meteoText} onChange={setMeteoText}
          rows={4}
          onRefresh={() => refresh('meteo')} />
        <Section title="3. Résultats — Indices" value={resultsText} onChange={setResultsText}
          rows={Math.max(8, assignedPoints.length + 6)}
          onRefresh={() => refresh('results')} />
        <Section title="4. Conformité 2026" value={conformiteText} onChange={setConformiteText}
          rows={Math.max(8, (conformiteSummary?.points.length ?? 0) + 8)}
          onRefresh={() => refresh('conformite')} />
        <Section title="5. Événements sources" value={eventsText} onChange={setEventsText}
          rows={Math.max(3, dayEvents.length + 3)}
          onRefresh={() => refresh('events')} />
        <Section title="6. Concordance" value={concordanceText} onChange={setConcordanceText}
          rows={Math.max(6, dayEvents.length * 3 + 4)}
          onRefresh={() => refresh('concordance')} />
      </div>
    </div>
  )
}

function Section({
  title,
  value,
  onChange,
  rows,
  onRefresh,
}: {
  title: string
  value: string
  onChange: (v: string) => void
  rows: number
  onRefresh: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {title}
        </label>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-emerald-400
                     px-1.5 py-0.5 rounded hover:bg-gray-800 transition-colors"
          title="Régénère cette section depuis les données chargées (écrase les modifications manuelles)"
        >
          <RefreshCw size={10} />
          Rafraîchir depuis les données
        </button>
      </div>
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
