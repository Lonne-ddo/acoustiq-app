/**
 * Web Worker de parsing en arrière-plan (gros fichiers).
 *
 * Deux chemins, un seul worker :
 *  - xlsx  : reçoit { buffer } → parseWorkbook (INCHANGÉ).
 *  - csv   : reçoit { file } (le File TEL QUEL, jamais pré-lu en ArrayBuffer) →
 *            parseCsv qui streame via file.stream() → aucune rematérialisation.
 *
 * Les deux délèguent au même mapping (rowToDataPoint) — un seul chemin de vérité.
 */
import type { MeasurementFile } from '../types'
import { parseWorkbook } from '../modules/formatDetectors'
import { parseCsv } from '../modules/csvParser'

interface ParseResult { type: 'result'; file: MeasurementFile }
interface ParseError { type: 'error'; fileName: string; error: string }
interface ParseProgress { type: 'progress'; fileName: string; percent: number }

type XlsxMessage = { buffer: ArrayBuffer; fileName: string }
type CsvMessage = { file: File; resumeFile?: File; fileName: string }

self.onmessage = async (e: MessageEvent<XlsxMessage | CsvMessage>) => {
  const data = e.data
  const fileName = data.fileName
  const onProgress = (fraction: number) => {
    self.postMessage({ type: 'progress', fileName, percent: Math.round(fraction * 100) } satisfies ParseProgress)
  }
  try {
    const file: MeasurementFile = 'file' in data
      // Chemin CSV EN FLUX : le File est passé tel quel (blob.stream()), jamais
      // rematérialisé en ArrayBuffer → pas d'OOM sur les gros relevés.
      ? await parseCsv(data.file, data.fileName, data.resumeFile, { onProgress })
      // Chemin xlsx INCHANGÉ.
      : parseWorkbook(data.buffer, data.fileName, { onProgress })
    self.postMessage({ type: 'result', file } satisfies ParseResult)
  } catch (err) {
    self.postMessage({
      type: 'error',
      fileName,
      error: err instanceof Error ? err.message : String(err),
    } satisfies ParseError)
  }
}
