/**
 * PDF.js chargé depuis CDN à la demande : extraction de texte ET rendu.
 *
 * On évite l'ajout d'une dépendance npm : le premier appel importe le module
 * PDF.js depuis cdnjs et configure le worker correspondant.
 *
 * Le module cœur `pdf.min.mjs` embarque DÉJÀ la couche de rendu (vérifié :
 * `getViewport`, `canvasContext`, `RenderTask`, `InternalRenderTask` y sont
 * présents). Inutile de tirer `pdfjs-dist/web/pdf_viewer`, qui n'apporte que
 * l'interface de visionneuse complète — hors de notre besoin. Conséquence :
 * la visionneuse intégrée n'ajoute AUCUN octet au bundle JS.
 */

const PDFJS_VERSION = '4.0.379'
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`
const WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`

/** Source d'un document : octets déjà en mémoire, ou URL à récupérer. */
export type PdfSource = { data: ArrayBuffer } | { url: string }

export interface PdfJsModule {
  getDocument: (src: PdfSource) => { promise: Promise<PdfJsDocument> }
  GlobalWorkerOptions: { workerSrc: string }
}
export interface PdfJsDocument {
  numPages: number
  getPage: (n: number) => Promise<PdfJsPage>
  /** Libère le worker et les ressources associées au document. */
  destroy?: () => Promise<void>
}
export interface PdfJsViewport {
  width: number
  height: number
}
export interface PdfJsRenderTask {
  promise: Promise<void>
  cancel: () => void
}
export interface PdfJsPage {
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>
  getViewport: (params: { scale: number }) => PdfJsViewport
  render: (params: {
    canvasContext: CanvasRenderingContext2D
    viewport: PdfJsViewport
  }) => PdfJsRenderTask
}

let pdfjsPromise: Promise<PdfJsModule> | null = null

/**
 * Charge PDF.js une seule fois pour toute la session (mémoïsé).
 * Exporté : la visionneuse et l'extraction partagent la MÊME instance, donc
 * le module CDN n'est téléchargé qu'une fois.
 */
export async function loadPdfJs(): Promise<PdfJsModule> {
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

/**
 * Ouvre un document PDF depuis une URL, pour la visionneuse intégrée.
 *
 * Chargement PARESSEUX de bout en bout : ni ce module, ni PDF.js, ni le PDF
 * lui-même ne sont téléchargés avant l'appel.
 */
export async function openPdfFromUrl(url: string): Promise<PdfJsDocument> {
  const pdfjs = await loadPdfJs()
  return pdfjs.getDocument({ url }).promise
}
