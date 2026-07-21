import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  Cloud,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  Printer,
  RefreshCw,
} from 'lucide-react'
import { showToast } from '../components/Toast'
import PointsList, {
  makeMeteoPoint,
  type MeteoPoint,
} from '../components/meteo/PointsList'
import MeteoMap from '../components/meteo/MeteoMap'
import SourceTable from '../components/meteo/SourceTable'
import ComparisonTable from '../components/meteo/ComparisonTable'
import {
  SOURCES,
  fetchSource,
  fetchECCCStations,
  classifyEcccFailure,
  ecccFailureMessage,
  isError,
  formatStationTrace,
  ecccFailureShort,
  type SourceId,
  type SourceOutcome,
  type SourceResult,
  type SourceError,
  type ECStationCandidate,
  type EcccFailure,
} from '../utils/meteoSources'
import {
  evaluateRecevabilite,
  RECEVABILITE_LABEL,
  DEFAUT_MELCCFP,
  type RecevabiliteHour,
  type RecevabiliteConfig,
} from '../utils/recevabilite'
import type {
  MeteoModuleState,
  PointMeteoResults,
  ProjectPointHint,
} from '../utils/meteoModule'

interface Props {
  state: MeteoModuleState
  onChange: (state: MeteoModuleState) => void
  /** Points assignés du projet, avec coordonnées si disponibles (Scene3D). */
  projectPoints: ProjectPointHint[]
}

export default function MeteoPage({ state, onChange, projectPoints }: Props) {
  const [fetching, setFetching] = useState(false)
  const [activePointId, setActivePointId] = useState<string | null>(null)
  // Candidats ECCC par point, DÉCOUPLÉS du SourceResult : ils survivent à un
  // échec horaire (obtenus avant la requête) → le sélecteur reste affiché.
  // Session-only (données réseau volatiles, non persistées avec le projet).
  const [ecccCandidatesByPoint, setEcccCandidatesByPoint] = useState<
    Record<string, ECStationCandidate[]>
  >({})
  // Stations ECCC tentées et échouées, par point → climateId → cause typée.
  // Marque les candidats déjà essayés dans le sélecteur (glyphe ✗ + cause).
  const [ecccFailedStations, setEcccFailedStations] = useState<
    Record<string, Record<string, EcccFailure>>
  >({})
  const lastFetchKeyRef = useRef<string | null>(null)

  /**
   * Mémorise l'issue ECCC d'un point : candidats (survivent au succès OU à
   * l'échec) + marquage de la station essayée (échec → cause ; succès → efface).
   */
  function recordEcccOutcome(
    pointId: string,
    outcome: SourceOutcome,
    chosenClimateId?: string,
  ) {
    const cands = outcome.candidates
    if (cands && cands.length > 0) {
      setEcccCandidatesByPoint((prev) => ({ ...prev, [pointId]: cands }))
    }
    if (!chosenClimateId) return
    if (isError(outcome) && outcome.ecccFailure) {
      const fail = outcome.ecccFailure
      setEcccFailedStations((prev) => ({
        ...prev,
        [pointId]: { ...(prev[pointId] ?? {}), [chosenClimateId]: fail },
      }))
    } else if (!isError(outcome)) {
      setEcccFailedStations((prev) => {
        const pf = { ...(prev[pointId] ?? {}) }
        delete pf[chosenClimateId]
        return { ...prev, [pointId]: pf }
      })
    }
  }

  const update = (patch: Partial<MeteoModuleState>) => onChange({ ...state, ...patch })

  // Synchronise activePointId avec la liste actuelle.
  useEffect(() => {
    if (state.results.length === 0) {
      setActivePointId(null)
      return
    }
    if (
      activePointId == null ||
      !state.results.some((r) => r.pointId === activePointId)
    ) {
      setActivePointId(state.results[0].pointId)
    }
  }, [state.results, activePointId])

  function setPoints(points: MeteoPoint[]) {
    update({ points })
  }

  function importFromProject() {
    if (projectPoints.length === 0) {
      showToast('Aucun point assigné dans le projet.', 'info')
      return
    }
    const existingLabels = new Set(state.points.map((p) => p.label))
    const toAdd: MeteoPoint[] = projectPoints
      .filter((pp) => !existingLabels.has(pp.label) && !existingLabels.has(pp.id))
      .map((pp) => {
        const has = pp.lat != null && pp.lng != null
        return {
          ...makeMeteoPoint(pp.label || pp.id),
          query: has ? `${pp.lat!.toFixed(5)}, ${pp.lng!.toFixed(5)}` : '',
          lat: has ? pp.lat! : null,
          lng: has ? pp.lng! : null,
          displayName: has ? `${pp.label || pp.id} (projet)` : null,
          geocoding: has ? 'ok' : 'idle',
        }
      })
    if (toAdd.length === 0) {
      showToast('Tous les points du projet sont déjà présents.', 'info')
      return
    }
    update({ points: [...state.points, ...toAdd] })
    const withCoords = toAdd.filter((p) => p.lat != null).length
    showToast(
      `${toAdd.length} point(s) importé(s)${withCoords < toAdd.length ? ` (${toAdd.length - withCoords} sans coordonnées — saisir adresse)` : ''}`,
      'success',
    )
  }

  function toggleSource(id: SourceId) {
    const next = new Set(state.selectedSources)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    update({ selectedSources: next })
  }

  async function runFetch() {
    const ready = state.points.filter((p) => p.lat != null && p.lng != null)
    if (ready.length === 0) {
      showToast('Aucun point géocodé. Saisissez au moins une adresse.', 'error')
      return
    }
    if (state.selectedSources.size === 0) {
      showToast('Sélectionnez au moins une source.', 'error')
      return
    }
    if (!state.startDate || !state.endDate) {
      showToast('Renseignez la plage de dates.', 'error')
      return
    }
    if (state.startDate > state.endDate) {
      showToast('Date de début postérieure à la date de fin.', 'error')
      return
    }

    setFetching(true)
    const sources = Array.from(state.selectedSources)
    const allResults: PointMeteoResults[] = []

    try {
      for (const point of ready) {
        const outcomes: SourceOutcome[] = await Promise.all(
          sources.map((s) =>
            fetchSource(
              s,
              point.lat!,
              point.lng!,
              state.startDate,
              state.endDate,
              s === 'eccc' ? state.eccStationByPoint[point.id] : undefined,
            ),
          ),
        )
        allResults.push({ pointId: point.id, outcomes })
        const ecccOut = outcomes.find((o) => o.source === 'eccc')
        if (ecccOut) recordEcccOutcome(point.id, ecccOut, state.eccStationByPoint[point.id])
      }
      update({ results: allResults })
      lastFetchKeyRef.current = JSON.stringify({
        ids: ready.map((p) => p.id),
        s: Array.from(state.selectedSources).sort(),
        d: [state.startDate, state.endDate],
      })
      const totalErrors = allResults
        .flatMap((r) => r.outcomes)
        .filter(isError).length
      const totalOk = allResults.flatMap((r) => r.outcomes).length - totalErrors
      showToast(
        `${totalOk} source(s) récupérée(s)${totalErrors > 0 ? ` · ${totalErrors} erreur(s)` : ''}`,
        totalErrors > 0 ? 'info' : 'success',
      )
    } catch (e) {
      showToast(`Erreur : ${(e as Error).message}`, 'error')
    } finally {
      setFetching(false)
    }
  }

  const pointResultsForMap = useMemo(() => {
    return state.results
      .map((r) => {
        const point = state.points.find((p) => p.id === r.pointId)
        if (!point) return null
        return { point, outcomes: r.outcomes }
      })
      .filter((x): x is { point: MeteoPoint; outcomes: SourceOutcome[] } => x !== null)
  }, [state.results, state.points])

  const activeResult = state.results.find((r) => r.pointId === activePointId)
  const activePoint = state.points.find((p) => p.id === activePointId)

  // Pré-calcul recevabilité par source (pour le point actif).
  const recevabiliteBySource = useMemo<Record<string, RecevabiliteHour[]>>(() => {
    if (!activeResult) return {}
    const out: Record<string, RecevabiliteHour[]> = {}
    for (const o of activeResult.outcomes) {
      if (isError(o)) continue
      out[o.source] = evaluateRecevabilite(o.rows, state.asphalt, state.recevabiliteConfig)
    }
    return out
  }, [activeResult, state.asphalt, state.recevabiliteConfig])

  const activeSources: SourceResult[] = useMemo(() => {
    if (!activeResult) return []
    return activeResult.outcomes.filter((o): o is SourceResult => !isError(o))
  }, [activeResult])

  const errorOutcomes = activeResult
    ? activeResult.outcomes.filter(isError)
    : []

  // Issue ECCC du point actif : succès (SourceResult) OU échec (SourceError).
  const ecccResult = activeSources.find((s) => s.source === 'eccc')
  const ecccOutcome = activeResult?.outcomes.find((o) => o.source === 'eccc')
  const ecccError: SourceError | undefined =
    ecccOutcome && isError(ecccOutcome) ? ecccOutcome : undefined

  /**
   * Sélection MANUELLE d'une station ECCC pour le point actif : persistée dans
   * eccStationByPoint, re-fetch de la seule source ECCC (pas de repli), et
   * remplacement en place de l'outcome ECCC du point.
   */
  async function chooseEcccStation(climateId: string) {
    if (!activePoint || activePointId == null || activePoint.lat == null || activePoint.lng == null)
      return
    setFetching(true)
    try {
      const outcome = await fetchSource(
        'eccc',
        activePoint.lat,
        activePoint.lng,
        state.startDate,
        state.endDate,
        climateId,
      )
      const results = state.results.map((r) => {
        if (r.pointId !== activePointId) return r
        let replaced = false
        const outcomes = r.outcomes.map((o) => {
          if (o.source === 'eccc') {
            replaced = true
            return outcome
          }
          return o
        })
        if (!replaced) outcomes.push(outcome)
        return { ...r, outcomes }
      })
      recordEcccOutcome(activePointId, outcome, climateId)
      update({
        eccStationByPoint: { ...state.eccStationByPoint, [activePointId]: climateId },
        results,
      })
      if (isError(outcome)) showToast(outcome.error, 'error')
      else showToast(`Station EC : ${outcome.station.name}`, 'success')
    } finally {
      setFetching(false)
    }
  }

  /**
   * Rafraîchit la liste des stations candidates (chemin de sortie : si toutes
   * ont échoué, on peut ré-obtenir une liste fraîche sans relancer un fetch
   * complet). N'écrit rien dans results — seulement candidats + purge des échecs.
   */
  async function refreshEcccStations() {
    if (!activePoint || activePointId == null || activePoint.lat == null || activePoint.lng == null)
      return
    setFetching(true)
    try {
      const cands = await fetchECCCStations(activePoint.lat, activePoint.lng)
      setEcccCandidatesByPoint((prev) => ({ ...prev, [activePointId]: cands }))
      setEcccFailedStations((prev) => ({ ...prev, [activePointId]: {} }))
      showToast(`${cands.length} station(s) ECCC trouvée(s).`, 'success')
    } catch (e) {
      showToast(ecccFailureMessage(classifyEcccFailure(e)), 'error')
    } finally {
      setFetching(false)
    }
  }

  // ───────── EXPORTS ─────────

  function exportCsvSource() {
    if (!activePoint || activeSources.length === 0) return
    const lines: string[][] = [
      [
        'source',
        'station',
        'datetime',
        'periode',
        'temperature_c',
        'humidite_pct',
        'precip_mm',
        'vent_kmh',
        'direction_deg',
        'recevabilite',
        'asphalte',
        'raisons',
      ],
    ]
    for (const s of activeSources) {
      const ev = recevabiliteBySource[s.source] ?? []
      const stationTrace = formatStationTrace(s.station)
      for (const h of ev) {
        lines.push([
          SOURCES[s.source].shortLabel,
          stationTrace,
          h.datetime,
          h.period,
          fmtCsv(h.temperature, 1),
          fmtCsv(h.humidity, 0),
          fmtCsv(h.precipitation, 2),
          fmtCsv(h.windSpeed, 1),
          fmtCsv(h.windDirection, 0),
          RECEVABILITE_LABEL[h.level],
          state.asphalt ? 'oui' : 'non',
          h.reasons.join(' · '),
        ])
      }
    }
    download(
      '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\n'),
      `meteo_${slug(activePoint.label)}_${state.startDate}_${state.endDate}.csv`,
      'text/csv;charset=utf-8',
    )
  }

  function exportCsvComparison() {
    if (!activeResult || activeSources.length === 0) return
    const sourceIds = activeSources.map((s) => s.source)
    const map = new Map<string, Record<string, number | null>>()
    for (const s of activeSources) {
      for (const r of s.rows) {
        const key = hourKey(r.datetime)
        const row = map.get(key) ?? {}
        row[`${s.source}_T`] = r.temperature
        row[`${s.source}_HR`] = r.humidity
        row[`${s.source}_Pp`] = r.precipitation
        row[`${s.source}_V`] = r.windSpeed
        row[`${s.source}_Dir`] = r.windDirection
        map.set(key, row)
      }
    }
    const sortedKeys = Array.from(map.keys()).sort()
    const header = ['datetime']
    sourceIds.forEach((id) => {
      const lbl = SOURCES[id].shortLabel
      header.push(
        `${lbl} T°C`,
        `${lbl} HR%`,
        `${lbl} Pp mm`,
        `${lbl} Vent km/h`,
        `${lbl} Dir °`,
      )
    })
    const lines: string[][] = [header]
    for (const key of sortedKeys) {
      const row = map.get(key)!
      const line = [key.replace('T', ' ') + ':00']
      for (const id of sourceIds) {
        line.push(
          fmtCsv(row[`${id}_T`], 1),
          fmtCsv(row[`${id}_HR`], 0),
          fmtCsv(row[`${id}_Pp`], 2),
          fmtCsv(row[`${id}_V`], 1),
          fmtCsv(row[`${id}_Dir`], 0),
        )
      }
      lines.push(line)
    }
    download(
      '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\n'),
      `meteo_comparaison_${slug(activePoint?.label ?? 'point')}_${state.startDate}_${state.endDate}.csv`,
      'text/csv;charset=utf-8',
    )
  }

  function exportXlsx() {
    if (!activePoint || activeSources.length === 0) return
    const wb = XLSX.utils.book_new()

    // Une feuille par source avec recevabilité.
    for (const s of activeSources) {
      const ev = recevabiliteBySource[s.source] ?? []
      const rows = ev.map((h) => ({
        Heure: h.datetime.replace('T', ' '),
        Période: h.period,
        'T °C': h.temperature,
        'HR %': h.humidity,
        'Précip mm': h.precipitation,
        'Vent km/h': h.windSpeed,
        'Direction °': h.windDirection,
        'Recevabilité §3.6': RECEVABILITE_LABEL[h.level],
        Asphalte: state.asphalt ? 'oui' : 'non',
        Raisons: h.reasons.join(' · '),
      }))
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(rows),
        SOURCES[s.source].shortLabel.slice(0, 31),
      )
    }

    // Feuille de comparaison.
    const sourceIds = activeSources.map((s) => s.source)
    const compMap = new Map<string, Record<string, number | string | null>>()
    for (const s of activeSources) {
      for (const r of s.rows) {
        const key = hourKey(r.datetime)
        const row = compMap.get(key) ?? { Heure: key.replace('T', ' ') + ':00' }
        const lbl = SOURCES[s.source].shortLabel
        row[`${lbl} T°C`] = r.temperature
        row[`${lbl} HR%`] = r.humidity
        row[`${lbl} Pp mm`] = r.precipitation
        row[`${lbl} Vent km/h`] = r.windSpeed
        compMap.set(key, row)
      }
    }
    const compRows = Array.from(compMap.values()).sort((a, b) =>
      String(a.Heure).localeCompare(String(b.Heure)),
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(compRows),
      'Comparaison',
    )

    // Feuille synthèse.
    const synth: Record<string, string | number>[] = [
      { Champ: 'Point', Valeur: activePoint.label },
      { Champ: 'Coordonnées', Valeur: `${activePoint.lat ?? ''}, ${activePoint.lng ?? ''}` },
      { Champ: 'Plage', Valeur: `${state.startDate} → ${state.endDate}` },
      { Champ: 'Sources', Valeur: sourceIds.map((id) => SOURCES[id].shortLabel).join(', ') },
      ...(ecccResult
        ? [{ Champ: 'Station EC utilisée', Valeur: formatStationTrace(ecccResult.station) }]
        : []),
      { Champ: 'Référentiel', Valeur: 'Lignes directrices MELCCFP — §3.6' },
      { Champ: 'Vent', Valeur: '< 20 km/h sinon non recevable' },
      { Champ: 'Précipitations', Valeur: '= 0 mm sinon mesures à retirer' },
      {
        Champ: 'Chaussée',
        Valeur: state.asphalt
          ? 'sèche exigée (asphalte à proximité) — sinon « à signaler »'
          : 'non considérée (pas d’asphalte à proximité)',
      },
      { Champ: 'Généré par AcoustiQ', Valeur: 'https://acoustiq-app.pages.dev' },
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(synth), 'Synthèse')

    XLSX.writeFile(
      wb,
      `meteo_${slug(activePoint.label)}_${state.startDate}_${state.endDate}.xlsx`,
    )
  }

  // ───────── UI ─────────

  const readyCount = state.points.filter((p) => p.lat != null && p.lng != null).length

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6 print-content">
        {/* En-tête imprimable — visible uniquement à l'impression */}
        <div className="print-only" style={{ borderBottom: '2px solid black', paddingBottom: '0.6rem', marginBottom: '1rem' }}>
          <h1 style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '0.3rem' }}>
            Rapport météo — recevabilité acoustique §3.6
          </h1>
          <div style={{ fontSize: '9pt', color: '#444' }}>
            {[
              activePoint
                ? `Point : ${activePoint.label}${activePoint.displayName ? ' — ' + activePoint.displayName : ''}`
                : null,
              `Période : ${state.startDate} → ${state.endDate}`,
              `Asphalte à proximité : ${(state.asphalt ?? true) ? 'oui' : 'non'}`,
              activeSources.length > 0
                ? `Sources : ${activeSources.map((s) => SOURCES[s.source].shortLabel).join(', ')}`
                : null,
              ecccResult ? `Station EC : ${formatStationTrace(ecccResult.station)}` : null,
              `Généré : ${new Date().toLocaleString('fr-CA')}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>

        <div className="flex items-start gap-3 pb-4 border-b border-gray-800 no-print">
          <Cloud size={28} className="text-emerald-400 mt-0.5" />
          <div>
            <h1 className="text-xl font-semibold text-gray-100">
              Module météo · multi-sources
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Récupération multi-sources et analyse de la recevabilité acoustique
              selon les critères québécois (REAFIE / MELCC).
            </p>
          </div>
        </div>

        {/* SECTION 1 — POINTS */}
        <section className="space-y-3 no-print">
          <SectionHeader index={1} title="Points de mesure" />
          <PointsList
            points={state.points}
            onChange={setPoints}
            onImportFromProject={importFromProject}
            importDisabled={projectPoints.length === 0}
            importHint={
              projectPoints.length === 0
                ? "Aucun point assigné dans le projet"
                : `${projectPoints.length} point(s) du projet`
            }
          />
        </section>

        {/* SECTION 2 — PARAMÈTRES */}
        <section className="space-y-3 no-print">
          <SectionHeader index={2} title="Paramètres" />
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">
                Date début
              </label>
              <input
                type="date"
                value={state.startDate}
                onChange={(e) => update({ startDate: e.target.value })}
                className="w-full text-sm bg-gray-800 text-gray-200 border border-gray-700
                           rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">
                Date fin
              </label>
              <input
                type="date"
                value={state.endDate}
                onChange={(e) => update({ endDate: e.target.value })}
                className="w-full text-sm bg-gray-800 text-gray-200 border border-gray-700
                           rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="text-[11px] text-gray-500">
              {readyCount}/{state.points.length} point(s) géocodé(s)
            </div>
          </div>

          <div>
            <div className="text-[11px] font-medium text-gray-500 mb-1.5">
              Sources à interroger
            </div>
            <div className="flex flex-wrap gap-2">
              {(['openmeteo', 'gem', 'eccc'] as SourceId[]).map((id) => {
                const meta = SOURCES[id]
                const checked = state.selectedSources.has(id)
                return (
                  <label
                    key={id}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded border text-xs cursor-pointer transition-colors ${
                      checked
                        ? 'bg-gray-100 text-gray-900 border-gray-100'
                        : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSource(id)}
                      className="hidden"
                    />
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ background: meta.color }}
                    />
                    {meta.shortLabel}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="rounded border border-gray-800 bg-gray-900/40 px-3 py-2 space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={state.asphalt ?? true}
                onChange={(e) => update({ asphalt: e.target.checked })}
                className="accent-emerald-500"
              />
              <span className="font-medium">Asphalte à proximité</span>
              <span className="text-gray-500">
                — active le critère « chaussée sèche » (§3.6)
              </span>
            </label>
            <div className="text-[10px] text-gray-500 leading-relaxed">
              Recevabilité §3.6 : vent{' '}
              <span className="text-gray-300">&lt; {state.recevabiliteConfig.windMaxKmh} km/h</span> ·
              précipitations{' '}
              <span className="text-gray-300">≤ {state.recevabiliteConfig.precipMaxMm} mm</span>
              {(state.asphalt ?? true)
                ? ' · chaussée sèche (sinon « à signaler »)'
                : ' · chaussée non considérée'}
            </div>
          </div>

          <RecevabiliteConfigEditor
            config={state.recevabiliteConfig}
            onChange={(recevabiliteConfig) => update({ recevabiliteConfig })}
          />

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => void runFetch()}
              disabled={fetching || readyCount === 0}
              className="px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium
                         hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed
                         flex items-center gap-2"
            >
              {fetching ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              Récupérer les données
            </button>
            {state.results.length > 0 && (
              <button
                onClick={() => update({ results: [] })}
                className="px-3 py-2 rounded bg-gray-800 text-gray-400 border border-gray-700
                           hover:bg-gray-700 hover:text-gray-200 text-sm flex items-center gap-1.5"
              >
                <RefreshCw size={12} /> Réinitialiser
              </button>
            )}
          </div>
        </section>

        {/* SECTION 3 — CARTE */}
        {pointResultsForMap.length > 0 && (
          <section className="space-y-3">
            <SectionHeader index={3} title="Carte" />
            <MeteoMap pointResults={pointResultsForMap} />
          </section>
        )}

        {/* SECTION 4 — TABLEAU PAR SOURCE */}
        {state.results.length > 0 && (
          <section className="space-y-3">
            <SectionHeader index={4} title="Tableau des données par point / source" />
            {state.results.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mr-1">
                  Point :
                </span>
                {state.results.map((r) => {
                  const p = state.points.find((pp) => pp.id === r.pointId)
                  if (!p) return null
                  const isActive = r.pointId === activePointId
                  return (
                    <button
                      key={r.pointId}
                      onClick={() => setActivePointId(r.pointId)}
                      className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                        isActive
                          ? 'bg-gray-100 text-gray-900 border-gray-100'
                          : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            )}
            {errorOutcomes.length > 0 && (
              <div className="space-y-1">
                {errorOutcomes.map((e, i) => (
                  <div
                    key={i}
                    className="text-xs text-rose-400 bg-rose-950/30 border border-rose-900/40 rounded px-2.5 py-1.5"
                  >
                    ⚠ {SOURCES[e.source].shortLabel} : {e.error}
                  </div>
                ))}
              </div>
            )}
            {activePointId != null && ecccOutcome && (
              <EcccStationBlock
                ok={ecccResult}
                error={ecccError}
                candidates={ecccCandidatesByPoint[activePointId] ?? []}
                currentClimateId={
                  state.eccStationByPoint[activePointId] ??
                  ecccResult?.station.climateId ??
                  null
                }
                isManual={activePointId in state.eccStationByPoint}
                failures={ecccFailedStations[activePointId] ?? {}}
                disabled={fetching}
                onChoose={chooseEcccStation}
                onRefresh={refreshEcccStations}
              />
            )}
            <SourceTable
              sources={activeSources}
              recevabiliteBySource={recevabiliteBySource}
              config={state.recevabiliteConfig}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={exportCsvSource}
                disabled={activeSources.length === 0}
                className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 border border-gray-700
                           hover:bg-gray-700 disabled:opacity-40 text-xs flex items-center gap-1.5"
              >
                <Download size={12} /> CSV par source
              </button>
              <button
                onClick={exportCsvComparison}
                disabled={activeSources.length < 2}
                className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 border border-gray-700
                           hover:bg-gray-700 disabled:opacity-40 text-xs flex items-center gap-1.5"
              >
                <Download size={12} /> CSV comparaison
              </button>
              <button
                onClick={exportXlsx}
                disabled={activeSources.length === 0}
                className="px-3 py-1.5 rounded bg-emerald-600 text-white
                           hover:bg-emerald-500 disabled:opacity-40 text-xs flex items-center gap-1.5"
              >
                <FileSpreadsheet size={12} /> XLSX formaté
              </button>
              <button
                onClick={() => window.print()}
                disabled={activeSources.length === 0}
                className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 border border-gray-700
                           hover:bg-gray-700 disabled:opacity-40 text-xs flex items-center gap-1.5"
                title="Imprimer un rapport (masque l'interface, ne garde que les données du point actif)"
              >
                <Printer size={12} /> Imprimer le rapport
              </button>
            </div>
          </section>
        )}

        {/* SECTION 5 — COMPARAISON */}
        {activeSources.length >= 2 && (
          <section className="space-y-3">
            <SectionHeader index={5} title="Vue comparaison (sources côte à côte)" />
            <ComparisonTable sources={activeSources} />
          </section>
        )}
      </div>
    </div>
  )
}

/**
 * Sélecteur manuel de station ECCC. La station retenue alimente la recevabilité
 * §3.6 → le choix est explicite (et persisté). Chaque candidat affiche de quoi
 * juger sa représentativité (distance, altitude, période de données).
 */
function fmtCandidate(c: ECStationCandidate): string {
  return [
    c.name,
    c.province ? `(${c.province})` : null,
    `${c.distance.toFixed(1)} km`,
    c.elevation != null ? `${c.elevation} m` : null,
    c.firstYear && c.lastYear ? `${c.firstYear}–${c.lastYear}` : null,
    'horaire',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Bloc « État Env. Canada » : TOUJOURS rendu quand ECCC est demandée (succès OU
 * échec), au-dessus de SourceTable → la station n'est jamais invisible. Statut
 * ✓/✗ (glyphe + texte, Okabe-Ito, couleur jamais seule) + sélecteur en liste qui
 * marque les stations déjà tentées et échouées avec leur cause.
 */
function EcccStationBlock({
  ok,
  error,
  candidates,
  currentClimateId,
  isManual,
  failures,
  disabled,
  onChoose,
  onRefresh,
}: {
  ok?: SourceResult
  error?: SourceError
  candidates: ECStationCandidate[]
  currentClimateId: string | null
  isManual: boolean
  failures: Record<string, EcccFailure>
  disabled: boolean
  onChoose: (climateId: string) => void
  onRefresh: () => void
}) {
  return (
    <div className="rounded border border-gray-800 bg-gray-900/40 px-3 py-2 space-y-2">
      {/* En-tête : label + badge auto/manuel + puce d'état + actualiser */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11px] font-medium text-gray-400">Station Env. Canada</label>
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider ${
            isManual
              ? 'bg-amber-900/40 text-amber-300 border border-amber-800/50'
              : 'bg-gray-800 text-gray-500 border border-gray-700'
          }`}
          title={
            isManual
              ? 'Station choisie manuellement (persistée avec le projet)'
              : 'Station retenue automatiquement (la plus proche exploitable)'
          }
        >
          {isManual ? 'manuel' : 'auto'}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled}
          aria-label="Actualiser la liste des stations Env. Canada"
          title="Actualiser la liste des stations"
          className="ml-auto inline-flex items-center gap-1 text-[10px] text-gray-400 border border-gray-700
                     rounded px-1.5 py-0.5 hover:text-gray-200 hover:border-gray-500 disabled:opacity-50"
        >
          <RefreshCw size={11} /> Actualiser
        </button>
      </div>

      {/* Ligne d'état : ✓ station utilisée, ou ✗ cause honnête (jamais la couleur seule) */}
      {ok ? (
        <div className="text-[11px] text-[#009E73] flex items-start gap-1.5">
          <span aria-hidden="true">✓</span>
          <span>Station : {formatStationTrace(ok.station)}</span>
        </div>
      ) : error ? (
        <div className="text-[11px] text-[#D55E00] flex items-start gap-1.5">
          <span aria-hidden="true">✗</span>
          <span>Env. Canada indisponible — {error.error}</span>
        </div>
      ) : null}

      {/* Sélecteur en liste : chaque candidat marqué (✓ utilisée / ✗ cause / ○ non tenté) */}
      {candidates.length > 0 ? (
        <div className="space-y-1" role="listbox" aria-label="Stations Env. Canada candidates">
          {candidates.map((c) => {
            const id = c.climateId ?? ''
            const fail = failures[id]
            const isCurrent = id !== '' && id === currentClimateId
            const glyph = fail ? '✗' : isCurrent ? '✓' : '○'
            const glyphClass = fail
              ? 'text-[#D55E00]'
              : isCurrent
                ? 'text-[#009E73]'
                : 'text-gray-600'
            const suffix = fail ? ecccFailureShort(fail) : isCurrent ? 'utilisée' : null
            const ariaLabel =
              c.name +
              (fail ? ` — échec : ${ecccFailureShort(fail)}` : isCurrent ? ' — station utilisée' : '')
            return (
              <button
                key={id || c.name}
                type="button"
                disabled={disabled || id === ''}
                onClick={() => id && onChoose(id)}
                aria-label={ariaLabel}
                aria-selected={isCurrent}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs border transition-colors disabled:opacity-50 ${
                  isCurrent
                    ? 'border-[#009E73]/50 bg-[#009E73]/10'
                    : 'border-gray-700 hover:bg-gray-800'
                }`}
              >
                <span className={`shrink-0 ${glyphClass}`} aria-hidden="true">
                  {glyph}
                </span>
                <span className="flex-1 text-gray-200">{fmtCandidate(c)}</span>
                {suffix && (
                  <span className={`shrink-0 text-[10px] ${fail ? 'text-[#D55E00]' : 'text-[#009E73]'}`}>
                    {suffix}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="text-[10px] text-gray-500 italic">Aucune station à proposer.</div>
      )}

      <div className="text-[10px] text-gray-500 leading-relaxed">
        La plus proche n'est pas toujours la plus représentative (relief, plan d'eau).
        Le choix alimente la recevabilité §3.6 et est tracé dans les exports.
      </div>
    </div>
  )
}

/**
 * Éditeur des seuils de recevabilité §3.6. Un seuil modifié CHANGE le verdict →
 * badge « seuils modifiés — non MELCCFP » (glyphe + texte, Okabe-Ito). Saisie
 * invalide : refus EXPLICITE sous le champ (jamais de blocage silencieux).
 */
function RecevabiliteConfigEditor({
  config,
  onChange,
}: {
  config: RecevabiliteConfig
  onChange: (c: RecevabiliteConfig) => void
}) {
  const isDefault =
    config.windMaxKmh === DEFAUT_MELCCFP.windMaxKmh &&
    config.precipMaxMm === DEFAUT_MELCCFP.precipMaxMm &&
    config.hrDryPct === DEFAUT_MELCCFP.hrDryPct
  return (
    <div className="rounded border border-gray-800 bg-gray-900/40 px-3 py-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-gray-400">Seuils de recevabilité §3.6</span>
        {!isDefault && (
          <span
            className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider text-[#E69F00] bg-[#E69F00]/10 border border-[#E69F00]/40"
            title="Au moins un seuil diffère des valeurs MELCCFP par défaut"
          >
            <AlertTriangle size={10} aria-hidden="true" /> seuils modifiés — non MELCCFP
          </span>
        )}
        <button
          type="button"
          onClick={() => onChange({ ...DEFAUT_MELCCFP })}
          disabled={isDefault}
          className="ml-auto text-[10px] text-gray-400 border border-gray-700 rounded px-1.5 py-0.5
                     hover:text-gray-200 hover:border-gray-500 disabled:opacity-40"
        >
          Valeurs MELCCFP
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <NumField
          label="Vent max (km/h)"
          value={config.windMaxKmh}
          min={0}
          max={100}
          step={1}
          onValid={(v) => onChange({ ...config, windMaxKmh: v })}
        />
        <NumField
          label="Précipitation max (mm) — appliquée à la recevabilité et à l'état de chaussée"
          value={config.precipMaxMm}
          min={0}
          max={50}
          step={0.1}
          onValid={(v) => onChange({ ...config, precipMaxMm: v })}
        />
        <NumField
          label="HR chaussée sèche (%)"
          value={config.hrDryPct}
          min={0}
          max={100}
          step={1}
          onValid={(v) => onChange({ ...config, hrDryPct: v })}
        />
      </div>
    </div>
  )
}

/** Champ numérique validé — refus explicite (glyphe ⚠ + texte), pas de vide silencieux. */
function NumField({
  label,
  value,
  min,
  max,
  step,
  onValid,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onValid: (v: number) => void
}) {
  const [raw, setRaw] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  // Resynchronise l'affichage quand la valeur change de l'extérieur (reset MELCCFP).
  useEffect(() => {
    setRaw(String(value))
    setError(null)
  }, [value])

  function handle(v: string) {
    setRaw(v)
    if (v.trim() === '') return setError('Valeur requise')
    const n = Number(v)
    if (!Number.isFinite(n)) return setError('Nombre invalide')
    if (n < min) return setError(`Minimum ${min}`)
    if (n > max) return setError(`Maximum ${max}`)
    setError(null)
    onValid(n) // n'écrit la config QUE si la saisie est valide
  }

  return (
    <div>
      <label className="block text-[10px] text-gray-500 mb-1 leading-tight">{label}</label>
      <input
        type="number"
        value={raw}
        min={min}
        max={max}
        step={step}
        aria-invalid={error != null}
        onChange={(e) => handle(e.target.value)}
        className={`w-full text-xs bg-gray-800 text-gray-200 border rounded px-2 py-1.5 focus:outline-none focus:ring-1 ${
          error ? 'border-[#D55E00] focus:ring-[#D55E00]' : 'border-gray-700 focus:ring-emerald-500'
        }`}
      />
      {error && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-[#D55E00]">
          <AlertTriangle size={10} aria-hidden="true" />
          <span>{error} — saisie refusée</span>
        </div>
      )}
    </div>
  )
}

function SectionHeader({ index, title }: { index: number; title: string }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-gray-800/60 pb-1.5">
      <span className="text-[10px] font-bold text-gray-600 tracking-widest">
        {String(index).padStart(2, '0')}
      </span>
      <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
    </div>
  )
}

function hourKey(s: string): string {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : s
}

function fmtCsv(v: number | null | undefined, decimals: number): string {
  if (v == null || !Number.isFinite(v)) return ''
  return v.toFixed(decimals)
}

function csvCell(v: string): string {
  if (/[",;\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 30) || 'point'
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

