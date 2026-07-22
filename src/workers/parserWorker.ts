/**
 * Web Worker de parsing XLSX en arrière-plan (gros fichiers > 1 Mo).
 *
 * Ne contient plus AUCUNE logique de détection/parsing propre : il délègue
 * intégralement à `parseWorkbook` (module partagé `formatDetectors`), le même
 * code que le main-thread. Un seul chemin de vérité pour les deux tailles de
 * fichier — fini les divergences worker ↔ main-thread.
 */
import type { MeasurementFile } from '../types'
import { parseWorkbook } from '../modules/formatDetectors'

interface ParseResult { type: 'result'; file: MeasurementFile }
interface ParseError { type: 'error'; fileName: string; error: string }
interface ParseProgress { type: 'progress'; fileName: string; percent: number }
type WorkerMessage = ParseResult | ParseError | ParseProgress

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  const { buffer, fileName } = e.data
  try {
    const file = parseWorkbook(buffer, fileName, {
      onProgress: (fraction) => {
        self.postMessage({
          type: 'progress',
          fileName,
          percent: Math.round(fraction * 100),
        } satisfies ParseProgress)
      },
    })
    self.postMessage({ type: 'result', file } satisfies WorkerMessage)
  } catch (err) {
    self.postMessage({
      type: 'error',
      fileName,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerMessage)
  }
}
