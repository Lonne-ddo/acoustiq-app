// Interfaces TypeScript pour AcoustiQ

export interface MeasurementFile {
  id: string
  name: string
  model: string
  serial: string
  date: string        // YYYY-MM-DD
  startTime: string   // HH:MM
  stopTime: string    // HH:MM
  point: string | null
  data: DataPoint[]
  rowCount: number
}

export interface DataPoint {
  t: number           // minutes depuis minuit
  laeq: number
  spectra?: number[]  // bandes tiers d'octave si disponibles
}

export interface SourceEvent {
  id: string
  label: string
  time: string
  day: string
  color: string
}

export type ConcordanceState = 'Confirmé' | 'Incertain' | 'Non visible'

/** Plage de zoom partagée entre le graphique et le spectrogramme */
export interface ZoomRange {
  startMin: number
  endMin: number
}
