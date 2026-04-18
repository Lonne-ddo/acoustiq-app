/**
 * Module Isolement acoustique — calcul du niveau reçu L2 dans une pièce
 * réceptrice à partir du niveau émis L1 et des parois séparatives (ISO 12354-1).
 *
 * Flux vertical : scénario → niveau émis → parois → pièce réceptrice → résultats.
 * L'état local n'est pas persisté dans le projet (utilisation ponctuelle).
 */
import { useMemo, useState } from 'react'
import { Volume } from 'lucide-react'
import ScenarioConfig, { type ScenarioType } from '../components/isolement/ScenarioConfig'
import SourceLevel from '../components/isolement/SourceLevel'
import WallTable, { type ScenarioWall } from '../components/isolement/WallTable'
import ReceptionRoom from '../components/isolement/ReceptionRoom'
import ResultsDisplay from '../components/isolement/ResultsDisplay'
import { computeIsolement, type IsoWallInput } from '../utils/isolementCalculator'
import type { MeasurementFile } from '../types'

interface Props {
  files: MeasurementFile[]
  selectedDate: string
  pointMap: Record<string, string>
}

export default function IsolementPage({ files, selectedDate, pointMap }: Props) {
  const [scenarioName, setScenarioName] = useState('')
  const [scenarioType, setScenarioType] = useState<ScenarioType>('ext-to-int')

  const [L1_by_band, setL1_by_band] = useState<Record<string, number>>({})

  const [walls, setWalls] = useState<ScenarioWall[]>([])
  const [flankCorrectionDb, setFlankCorrectionDb] = useState<number>(-5)

  const [volumeM3, setVolumeM3] = useState<number>(30)
  const [rtSeconds, setRtSeconds] = useState<number>(0.5)

  const [criterionDBA, setCriterionDBA] = useState<number | null>(null)

  const result = useMemo(() => {
    if (Object.keys(L1_by_band).length === 0) return null
    if (walls.length === 0) return null
    if (!(volumeM3 > 0) || !(rtSeconds > 0)) return null
    const input: IsoWallInput[] = walls.map((w) => ({
      id: w.id,
      name: w.name,
      area: w.area,
      R_by_band: w.R_by_band,
    }))
    return computeIsolement(L1_by_band, input, volumeM3, rtSeconds, flankCorrectionDb)
  }, [L1_by_band, walls, volumeM3, rtSeconds, flankCorrectionDb])

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <header className="flex items-center gap-2 pb-2 border-b border-gray-800">
          <Volume size={18} className="text-emerald-400" />
          <h2 className="text-base font-semibold text-gray-100">Isolement acoustique</h2>
          <span className="text-xs text-gray-500">— ISO 12354-1, calcul en bandes de tiers d'octave 100 Hz – 5 kHz</span>
        </header>

        <ScenarioConfig
          name={scenarioName}
          onNameChange={setScenarioName}
          type={scenarioType}
          onTypeChange={setScenarioType}
        />

        <SourceLevel
          files={files}
          selectedDate={selectedDate}
          pointMap={pointMap}
          L1_by_band={L1_by_band}
          onL1Change={setL1_by_band}
        />

        <WallTable
          walls={walls}
          onChange={setWalls}
          flankCorrectionDb={flankCorrectionDb}
          onFlankChange={setFlankCorrectionDb}
        />

        <ReceptionRoom
          volumeM3={volumeM3}
          rtSeconds={rtSeconds}
          onVolumeChange={setVolumeM3}
          onRtChange={setRtSeconds}
        />

        <ResultsDisplay
          scenarioName={scenarioName}
          scenarioType={scenarioType}
          result={result}
          criterionDBA={criterionDBA}
          onCriterionChange={setCriterionDBA}
          walls={walls}
          volumeM3={volumeM3}
          rtSeconds={rtSeconds}
          flankCorrectionDb={flankCorrectionDb}
        />
      </div>
    </div>
  )
}
