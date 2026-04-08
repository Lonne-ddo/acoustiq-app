/**
 * Extraction de texte depuis un PDF via PDF.js (chargé depuis CDN à la demande).
 *
 * On évite l'ajout d'une dépendance npm : la première extraction injecte
 * le script PDF.js depuis cdnjs et configure le worker correspondant.
 */

const PDFJS_VERSION = '4.0.379'
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`
const WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`

interface PdfJsModule {
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfJsDocument> }
  GlobalWorkerOptions: { workerSrc: string }
}
interface PdfJsDocument {
  numPages: number
  getPage: (n: number) => Promise<PdfJsPage>
}
interface PdfJsPage {
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>
}

let pdfjsPromise: Promise<PdfJsModule> | null = null

async function loadPdfJs(): Promise<PdfJsModule> {
  if (pdfjsPromise) return pdfjsPromise
  pdfjsPromise = (async () => {
    // Import dynamique du module ESM hébergé sur CDN.
    // @vite-ignore : URL dynamique non résolvable au build.
    const mod = (await import(/* @vite-ignore */ PDFJS_URL)) as unknown as PdfJsModule
    mod.GlobalWorkerOptions.workerSrc = WORKER_URL
    return mod
  })()
  return pdfjsPromise
}

/**
 * Extrait l'intégralité du texte d'un PDF.
 * @param data ArrayBuffer du fichier PDF
 * @returns texte concaténé page par page (séparées par double saut de ligne)
 */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfJs()
  const doc = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const text = content.items
      .map((it) => it.str ?? '')
      .filter(Boolean)
      .join(' ')
    pages.push(text)
  }
  return pages.join('\n\n').replace(/[ \t]+/g, ' ').trim()
}
