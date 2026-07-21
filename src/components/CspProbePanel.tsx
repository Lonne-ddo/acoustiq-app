/**
 * Diagnostic réseau — sonde les fetch cross-origin dont dépendent les modules
 * réseau d'AcoustiQ, pour vérifier s'ils passent la CSP du player Power Apps.
 *
 * Contexte migration Code App : l'app tourne dans l'iframe du player, qui peut
 * imposer une `Content-Security-Policy` (`connect-src`) restrictive. Aucun proxy
 * n'est utilisé — tous ces appels sont directs vers des API tierces CORS-ouvertes
 * en navigateur normal. Sous le player, un appel qui échoue = très probablement
 * un blocage CSP `connect-src` (indistinguable côté JS d'un échec CORS/réseau —
 * tous remontent une `TypeError`). L'objectif ici est OK vs bloqué, par ligne.
 *
 * Un fetch qui RÉSOUT (même en 4xx/5xx) prouve que la connexion a été autorisée
 * → OK. Un fetch qui LÈVE (TypeError) → bloqué.
 */
import { useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Circle, Play } from 'lucide-react'

type Status = 'idle' | 'testing' | 'ok' | 'blocked'

interface Target {
  key: string
  group: string
  label: string
  /** Module AcoustiQ qui en dépend (pour tracer l'impact d'un blocage). */
  usedBy: string
  run: (signal: AbortSignal) => Promise<Response>
}

const TIMEOUT_MS = 12000

const TARGETS: Target[] = [
  {
    key: 'open-meteo-forecast',
    group: 'Météo',
    label: 'Open-Meteo — prévisions (api.open-meteo.com)',
    usedBy: 'utils/meteoSources.ts',
    run: (signal) =>
      fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=45.5&longitude=-73.6&hourly=temperature_2m&forecast_days=1',
        { signal },
      ),
  },
  {
    key: 'open-meteo-gem',
    group: 'Météo',
    label: 'Open-Meteo GEM (/v1/gem)',
    usedBy: 'utils/meteoSources.ts (fetchGEM)',
    run: (signal) =>
      fetch(
        'https://api.open-meteo.com/v1/gem?latitude=45.5&longitude=-73.6&hourly=temperature_2m,wind_speed_10m&models=gem_seamless&forecast_days=1&timezone=America/Toronto&wind_speed_unit=kmh',
        { signal },
      ),
  },
  {
    key: 'open-meteo-archive',
    group: 'Météo',
    label: 'Open-Meteo — archive (archive-api.open-meteo.com)',
    usedBy: 'utils/meteoSources.ts',
    run: (signal) =>
      fetch(
        'https://archive-api.open-meteo.com/v1/archive?latitude=45.5&longitude=-73.6&start_date=2024-01-01&end_date=2024-01-01&hourly=temperature_2m',
        { signal },
      ),
  },
  {
    key: 'eccc',
    group: 'Météo',
    label: 'ECCC — stations climato (api.weather.gc.ca)',
    usedBy: 'utils/meteoSources.ts',
    run: (signal) =>
      fetch(
        'https://api.weather.gc.ca/collections/climate-stations/items?limit=1&f=json',
        { signal },
      ),
  },
  {
    key: 'eccc-climate-hourly',
    group: 'Météo',
    label: 'ECCC climate-hourly',
    usedBy: 'utils/meteoSources.ts (fetchECCCHourly)',
    run: (signal) =>
      fetch(
        'https://api.weather.gc.ca/collections/climate-hourly/items?CLIMATE_IDENTIFIER=7025250&datetime=2024-01-01T00:00:00Z/2024-01-01T23:59:59Z&limit=10&sortby=LOCAL_DATE&f=json',
        { signal },
      ),
  },
  {
    key: 'photon',
    group: 'Géocodage',
    label: 'Photon / Komoot (photon.komoot.io)',
    usedBy: 'utils/geocoding.ts',
    run: (signal) =>
      fetch('https://photon.komoot.io/api?q=montreal&limit=1', { signal }),
  },
  {
    key: 'open-meteo-geocoding',
    group: 'Géocodage',
    label: 'Open-Meteo geocoding (geocoding-api.open-meteo.com)',
    usedBy: 'utils/geocoding.ts',
    run: (signal) =>
      fetch(
        'https://geocoding-api.open-meteo.com/v1/search?name=montreal&count=1',
        { signal },
      ),
  },
  {
    key: 'nominatim',
    group: 'Vue 3D',
    label: 'Nominatim OSM (nominatim.openstreetmap.org)',
    usedBy: 'components/Vue3DTab.tsx',
    run: (signal) =>
      fetch(
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=montreal',
        { signal },
      ),
  },
  {
    key: 'overpass',
    group: 'Vue 3D',
    label: 'Overpass API — POST (overpass-api.de)',
    usedBy: 'components/Vue3DTab.tsx',
    run: (signal) =>
      fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent('[out:json][timeout:10];node(0,0,0,0);out;'),
        signal,
      }),
  },
  {
    key: 'yamnet-tfhub',
    group: 'YAMNet (audio IA)',
    label: 'Modèle TFHub (tfhub.dev)',
    usedBy: 'utils/yamnetProcessor.ts',
    run: (signal) =>
      fetch('https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1/model.json?tfjs-format=file', {
        signal,
      }),
  },
  {
    key: 'yamnet-gstorage',
    group: 'YAMNet (audio IA)',
    label: 'Modèle Google Storage (storage.googleapis.com)',
    usedBy: 'utils/yamnetProcessor.ts',
    run: (signal) =>
      fetch('https://storage.googleapis.com/tfjs-models/savedmodel/yamnet/model.json', {
        signal,
      }),
  },
]

interface Result {
  status: Status
  httpStatus?: number
  ms?: number
  detail?: string
}

function StatusBadge({ r }: { r: Result }) {
  if (r.status === 'testing')
    return (
      <span className="inline-flex items-center gap-1 text-amber-300">
        <Loader2 size={14} className="animate-spin" /> test…
      </span>
    )
  if (r.status === 'ok')
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <CheckCircle2 size={14} /> OK{typeof r.httpStatus === 'number' ? ` (${r.httpStatus})` : ''}
      </span>
    )
  if (r.status === 'blocked')
    return (
      <span className="inline-flex items-center gap-1 text-rose-400">
        <XCircle size={14} /> bloqué
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-gray-500">
      <Circle size={14} /> —
    </span>
  )
}

export default function CspProbePanel() {
  const [results, setResults] = useState<Record<string, Result>>({})
  const [running, setRunning] = useState(false)

  async function probe(t: Target): Promise<Result> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const started = performance.now()
    try {
      const res = await t.run(controller.signal)
      const ms = Math.round(performance.now() - started)
      // Connexion autorisée (même un 4xx/5xx prouve que la CSP a laissé passer).
      return { status: 'ok', httpStatus: res.status, ms }
    } catch (err) {
      const ms = Math.round(performance.now() - started)
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      const detail = aborted
        ? `timeout > ${TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : 'erreur inconnue'
      return { status: 'blocked', ms, detail }
    } finally {
      clearTimeout(timer)
    }
  }

  async function runAll() {
    setRunning(true)
    setResults(Object.fromEntries(TARGETS.map((t) => [t.key, { status: 'testing' as Status }])))
    const entries = await Promise.all(
      TARGETS.map(async (t) => [t.key, await probe(t)] as const),
    )
    setResults(Object.fromEntries(entries))
    setRunning(false)
  }

  async function runOne(t: Target) {
    setResults((prev) => ({ ...prev, [t.key]: { status: 'testing' } }))
    const r = await probe(t)
    setResults((prev) => ({ ...prev, [t.key]: r }))
  }

  const groups = Array.from(new Set(TARGETS.map((t) => t.group)))
  const okCount = Object.values(results).filter((r) => r.status === 'ok').length
  const blockedCount = Object.values(results).filter((r) => r.status === 'blocked').length

  return (
    <div className="p-6 max-w-3xl mx-auto text-gray-200">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-100">Diagnostic réseau — CSP du player</h2>
        <p className="mt-1 text-sm text-gray-400">
          Sonde les appels cross-origin des modules réseau. Aucun proxy n'est utilisé :
          ces API sont CORS-ouvertes en navigateur normal. Sous le player Power Apps, un
          échec = très probablement un blocage CSP <code className="text-gray-300">connect-src</code>.
          Un appel qui répond (même 4xx) prouve que la connexion a été autorisée.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={runAll}
          disabled={running}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          Lancer tous les tests
        </button>
        {(okCount > 0 || blockedCount > 0) && (
          <span className="text-sm text-gray-400">
            <span className="text-emerald-400">{okCount} OK</span> ·{' '}
            <span className="text-rose-400">{blockedCount} bloqué(s)</span>
          </span>
        )}
      </div>

      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">{g}</h3>
            <div className="rounded-lg border border-gray-800 divide-y divide-gray-800 overflow-hidden">
              {TARGETS.filter((t) => t.group === g).map((t) => {
                const r = results[t.key] ?? { status: 'idle' as Status }
                return (
                  <div
                    key={t.key}
                    className="flex items-center gap-3 px-3 py-2 bg-gray-900/40 hover:bg-gray-900/70"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 truncate">{t.label}</div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {t.usedBy}
                        {r.ms != null && <span> · {r.ms} ms</span>}
                        {r.detail && <span className="text-rose-400/80"> · {r.detail}</span>}
                      </div>
                    </div>
                    <div className="w-28 text-sm shrink-0 text-right">
                      <StatusBadge r={r} />
                    </div>
                    <button
                      onClick={() => runOne(t)}
                      disabled={r.status === 'testing'}
                      className="shrink-0 px-2 py-1 text-[11px] rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 disabled:opacity-40 transition-colors"
                    >
                      Tester
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-5 text-[11px] text-gray-600 leading-relaxed">
        Note : côté JavaScript, un blocage CSP, un échec CORS et une panne réseau remontent
        tous une <code className="text-gray-500">TypeError « Failed to fetch »</code> —
        indistinguables. En navigateur brut ces cibles répondent OK ; un « bloqué » observé
        uniquement dans le player pointe donc vers la CSP <code className="text-gray-500">connect-src</code> de l'iframe.
      </p>
    </div>
  )
}
