/**
 * Visionneuse PDF intégrée — rendu CANVAS via PDF.js.
 *
 * Chargée en `React.lazy` depuis RegulationTab : son code ne quitte le serveur
 * qu'au premier clic sur « Consulter ». Le bundle principal reste intact.
 *
 * ── Pourquoi un canvas et pas <iframe> / <embed>
 * `public/_headers` impose `X-Frame-Options: DENY` sur `/*`. Un cadre — même de
 * même origine — serait donc bloqué en production Cloudflare, TOUT EN
 * fonctionnant en Local Play, où Vite sert `_headers` comme fichier statique
 * inerte sans jamais appliquer l'en-tête. Le rendu canvas échappe entièrement
 * à cette mécanique.
 *
 * Navigation volontairement minimale : page précédente / suivante, numéro de
 * page, zoom. Rien d'autre.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { openPdfFromUrl, type PdfJsDocument, type PdfJsRenderTask } from '../modules/pdfExtract'

const PALIERS_ZOOM = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const
const ZOOM_DEFAUT_INDEX = 3 // 1,25

/** Ce que la visionneuse peut rapporter quand elle n'affiche pas de page. */
type EtatChargement =
  | { phase: 'chargement' }
  | { phase: 'pret' }
  | { phase: 'echec'; motif: string }

export interface PdfViewerProps {
  /** URL absolue du PDF, déjà résolue contre la base du document. */
  url: string
  /** Titre affiché dans la barre d'outils. */
  titre: string
  /** Nom de fichier proposé au téléchargement. */
  nomFichier: string
  onClose: () => void
}

export default function PdfViewer({ url, titre, nomFichier, onClose }: PdfViewerProps) {
  const [doc, setDoc] = useState<PdfJsDocument | null>(null)
  const [etat, setEtat] = useState<EtatChargement>({ phase: 'chargement' })
  const [page, setPage] = useState(1)
  const [zoomIndex, setZoomIndex] = useState<number>(ZOOM_DEFAUT_INDEX)
  const [rendu, setRendu] = useState<EtatChargement>({ phase: 'chargement' })

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const tacheRef = useRef<PdfJsRenderTask | null>(null)

  // ── Ouverture du document ─────────────────────────────────────────────────
  useEffect(() => {
    let annule = false
    let ouvert: PdfJsDocument | null = null

    // Pas de setState synchrone ici : l'état initial EST déjà « chargement », et
    // le composant est remonté à chaque ouverture (clé sur l'URL côté appelant).
    openPdfFromUrl(url)
      .then((d) => {
        if (annule) {
          void d.destroy?.()
          return
        }
        ouvert = d
        setDoc(d)
        setPage(1)
        setEtat({ phase: 'pret' })
      })
      .catch((err) => {
        if (annule) return
        // Échec TECHNIQUE : PDF.js injoignable (CDN bloqué, hors ligne) ou
        // fichier illisible. Ce n'est pas « le document n'existe pas ».
        setEtat({
          phase: 'echec',
          motif: `Ouverture impossible — ${err instanceof Error ? err.message : String(err)}`,
        })
      })

    return () => {
      annule = true
      tacheRef.current?.cancel()
      tacheRef.current = null
      void ouvert?.destroy?.()
    }
  }, [url])

  // ── Rendu de la page courante ─────────────────────────────────────────────
  useEffect(() => {
    if (!doc) return
    const canvas = canvasRef.current
    if (!canvas) return

    let annule = false

    // Une tâche de rendu en cours doit être annulée avant d'en lancer une autre :
    // PDF.js rejette deux rendus concurrents sur le même canvas.
    tacheRef.current?.cancel()
    tacheRef.current = null

    doc
      .getPage(page)
      .then((p) => {
        if (annule) return
        // Basculé ici, et non dans le corps de l'effet : évite un setState
        // synchrone et, accessoirement, le clignotement quand la page est déjà
        // en cache côté PDF.js.
        setRendu({ phase: 'chargement' })
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          setRendu({ phase: 'echec', motif: 'Contexte canvas 2D indisponible' })
          return
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = p.getViewport({ scale: PALIERS_ZOOM[zoomIndex] * dpr })

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`

        const tache = p.render({ canvasContext: ctx, viewport })
        tacheRef.current = tache
        return tache.promise.then(() => {
          if (!annule) setRendu({ phase: 'pret' })
        })
      })
      .catch((err) => {
        // L'annulation volontaire n'est pas une erreur à montrer.
        const msg = err instanceof Error ? err.message : String(err)
        if (annule || /cancel/i.test(msg)) return
        setRendu({ phase: 'echec', motif: `Rendu de la page ${page} échoué — ${msg}` })
      })

    return () => {
      annule = true
    }
  }, [doc, page, zoomIndex])

  const nbPages = doc?.numPages ?? 0
  const precedent = useCallback(() => setPage((p) => Math.max(1, p - 1)), [])
  const suivant = useCallback(
    () => setPage((p) => (nbPages ? Math.min(nbPages, p + 1) : p)),
    [nbPages],
  )

  // ── Clavier : Échap ferme, flèches paginent ──────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Empêche le gestionnaire global d'App.tsx de réagir en plus.
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowLeft') {
        e.stopPropagation()
        precedent()
      } else if (e.key === 'ArrowRight') {
        e.stopPropagation()
        suivant()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, precedent, suivant])

  const zoomPct = Math.round(PALIERS_ZOOM[zoomIndex] * 100)

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Visionneuse — ${titre}`}
    >
      {/* Barre d'outils */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-gray-200 truncate max-w-[40%]" title={titre}>
          {titre}
        </span>

        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={precedent}
            disabled={page <= 1}
            className="p-1 rounded text-gray-300 hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Page précédente"
            title="Page précédente"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-[11px] text-gray-400 tabular-nums min-w-[4.5rem] text-center">
            {nbPages ? `${page} / ${nbPages}` : '— / —'}
          </span>
          <button
            onClick={suivant}
            disabled={!nbPages || page >= nbPages}
            className="p-1 rounded text-gray-300 hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Page suivante"
            title="Page suivante"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            disabled={zoomIndex <= 0}
            className="p-1 rounded text-gray-300 hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Réduire le zoom"
            title="Réduire le zoom"
          >
            <ZoomOut size={15} />
          </button>
          <span className="text-[11px] text-gray-400 tabular-nums min-w-[3rem] text-center">
            {zoomPct} %
          </span>
          <button
            onClick={() => setZoomIndex((i) => Math.min(PALIERS_ZOOM.length - 1, i + 1))}
            disabled={zoomIndex >= PALIERS_ZOOM.length - 1}
            className="p-1 rounded text-gray-300 hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Augmenter le zoom"
            title="Augmenter le zoom"
          >
            <ZoomIn size={15} />
          </button>
        </div>

        <a
          href={url}
          download={nomFichier}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-emerald-300
                     border border-emerald-800/60 hover:bg-emerald-950/40"
          title="Télécharger le PDF"
        >
          <Download size={12} /> Télécharger
        </a>

        <button
          onClick={onClose}
          className="p-1 rounded text-gray-300 hover:bg-gray-800"
          aria-label="Fermer la visionneuse"
          title="Fermer (Échap)"
        >
          <X size={16} />
        </button>
      </div>

      {/* Zone de page — défilement propre à ce conteneur, jamais au corps */}
      <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-4">
        {etat.phase === 'echec' ? (
          <div className="max-w-lg mt-16 px-4 py-3 rounded border border-rose-800/60 bg-rose-950/30">
            <div className="flex items-center gap-2 text-xs font-semibold text-rose-300">
              <AlertTriangle size={13} /> Échec technique
            </div>
            <p className="mt-1 text-[11px] text-rose-200/90 leading-relaxed">{etat.motif}</p>
            <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
              Le document n&apos;est pas en cause : c&apos;est son affichage qui a échoué. Le
              téléchargement ci-dessus et le lien officiel restent utilisables.
            </p>
          </div>
        ) : (
          <div className="relative">
            <canvas ref={canvasRef} className="max-w-full shadow-lg bg-white" />
            {(etat.phase === 'chargement' || rendu.phase === 'chargement') && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-gray-950/60">
                <Loader2 size={18} className="text-emerald-400 animate-spin" />
                <span className="text-xs text-gray-300">
                  {etat.phase === 'chargement' ? 'Ouverture du document…' : 'Rendu de la page…'}
                </span>
              </div>
            )}
            {rendu.phase === 'echec' && (
              <div className="absolute inset-x-0 bottom-0 px-3 py-2 bg-rose-950/80 text-[11px] text-rose-200">
                <AlertTriangle size={11} className="inline mr-1" />
                {rendu.motif}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
