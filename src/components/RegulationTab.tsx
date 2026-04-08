/**
 * Onglet « Réglementation »
 *
 * - Téléversement de PDF (extraction texte via PDF.js CDN, stockage localStorage)
 * - Métadonnées éditables (titre, source, date, statut)
 * - Recherche plein-texte avec filtres
 * - Panneau de liens officiels
 *
 * TODO: When AI is integrated, use regulationDB.searchDocs(query) to retrieve
 * relevant regulatory context before generating advice. Each chunk should be
 * < 500 tokens for optimal retrieval.
 */
import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Scale,
  Upload,
  Trash2,
  Search,
  ExternalLink,
  Loader2,
  FileText,
  Link as LinkIcon,
} from 'lucide-react'
import {
  ensureSeeded,
  addDoc,
  updateDoc,
  removeDoc,
  searchDocs,
  chunkText,
  OFFICIAL_SOURCES,
  type RegulationDoc,
  type RegulationSource,
  type RegulationStatus,
  type SearchHit,
} from '../modules/regulationDB'
import { extractPdfText } from '../modules/pdfExtract'

const SOURCES: RegulationSource[] = [
  'REAFIE',
  'Lignes directrices MELCCFP',
  'LQE',
  'ISO',
  'Autre',
]
const STATUSES: RegulationStatus[] = ['En vigueur', 'Remplacé', 'Archivé']

const STATUS_BADGE: Record<RegulationStatus, string> = {
  'En vigueur': 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60',
  Remplacé: 'bg-orange-900/40 text-orange-300 border-orange-800/60',
  Archivé: 'bg-gray-800/60 text-gray-400 border-gray-700/60',
}

function guessSourceFromName(name: string): RegulationSource {
  const n = name.toLowerCase()
  if (n.includes('reafie')) return 'REAFIE'
  if (n.includes('lqe') || n.includes('q-2')) return 'LQE'
  if (n.includes('iso')) return 'ISO'
  if (n.includes('lignes') || n.includes('melccfp') || n.includes('bruit')) return 'Lignes directrices MELCCFP'
  return 'Autre'
}

export default function RegulationTab() {
  const [docs, setDocs] = useState<RegulationDoc[]>([])
  const [busy, setBusy] = useState(false)
  const [busyMsg, setBusyMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // Recherche
  const [query, setQuery] = useState('')
  const [filterSource, setFilterSource] = useState<RegulationSource | 'all'>('all')
  const [activeOnly, setActiveOnly] = useState(false)

  useEffect(() => {
    setDocs(ensureSeeded())
  }, [])

  // ── Upload PDF ────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (list.length === 0) {
      setError('Seuls les fichiers PDF sont acceptés.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      for (const file of list) {
        setBusyMsg(`Extraction de ${file.name}…`)
        const buf = await file.arrayBuffer()
        const text = await extractPdfText(buf)
        const chunks = chunkText(text)
        const doc: RegulationDoc = {
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          filename: file.name,
          title: file.name.replace(/\.pdf$/i, ''),
          source: guessSourceFromName(file.name),
          dateAdded: new Date().toISOString(),
          dateDocument: '',
          status: 'En vigueur',
          fullText: text,
          chunks,
        }
        try {
          setDocs(addDoc(doc))
        } catch {
          setError(
            'Quota localStorage dépassé — supprimez d\'anciens documents avant d\'en ajouter de nouveaux.',
          )
          return
        }
      }
    } catch (err) {
      console.error(err)
      setError(`Extraction échouée : ${String(err)}`)
    } finally {
      setBusy(false)
      setBusyMsg('')
    }
  }, [])

  // ── Drag & drop ───────────────────────────────────────────────────────────
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation(); setDragOver(true)
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
  }

  // ── Patch document ────────────────────────────────────────────────────────
  function patch(id: string, p: Partial<RegulationDoc>) {
    setDocs(updateDoc(id, p))
  }
  function remove(id: string) {
    if (!confirm('Supprimer ce document de la base réglementaire ?')) return
    setDocs(removeDoc(id))
  }

  // ── Recherche ─────────────────────────────────────────────────────────────
  const hits: SearchHit[] = useMemo(() => {
    if (!query.trim()) return []
    return searchDocs(query, { source: filterSource, activeOnly })
  }, [query, filterSource, activeOnly, docs])

  // Liste filtrée pour l'affichage par cartes
  const visibleDocs = useMemo(() => {
    return docs.filter((d) => {
      if (activeOnly && d.status !== 'En vigueur') return false
      if (filterSource !== 'all' && d.source !== filterSource) return false
      return true
    })
  }, [docs, activeOnly, filterSource])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-800 shrink-0">
        <Scale size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Réglementation
        </span>
        <span className="text-[10px] text-gray-600">{docs.length} document(s)</span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 max-w-5xl">
        {/* ─── A) Téléversement ─────────────────────────────────────────── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            A · Documents téléversés
          </h3>

          <label
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 px-6 py-6 rounded-lg
                        border-2 border-dashed cursor-pointer transition-colors
                        ${dragOver
                          ? 'border-emerald-500 bg-emerald-950/20'
                          : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'}`}
          >
            {busy ? (
              <>
                <Loader2 size={22} className="text-emerald-400 animate-spin" />
                <span className="text-xs text-gray-400">{busyMsg || 'Traitement…'}</span>
              </>
            ) : (
              <>
                <Upload size={22} className="text-gray-500" />
                <span className="text-xs text-gray-400">
                  Glisser des PDF ici ou cliquer pour choisir
                </span>
                <span className="text-[10px] text-gray-600">
                  Texte extrait via PDF.js et stocké en chunks (~400 mots) dans le navigateur
                </span>
              </>
            )}
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>

          {error && (
            <div className="mt-2 px-3 py-2 rounded border border-rose-800/60 bg-rose-950/30 text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* Filtres communs aux cartes et à la recherche */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as RegulationSource | 'all')}
              className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">Toutes les sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
                className="accent-emerald-500"
              />
              En vigueur seulement
            </label>
          </div>

          {/* Cartes documents */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            {visibleDocs.length === 0 && (
              <div className="text-xs text-gray-600 italic col-span-full">
                Aucun document ne correspond aux filtres.
              </div>
            )}
            {visibleDocs.map((d) => (
              <DocCard
                key={d.id}
                doc={d}
                onChange={(p) => patch(d.id, p)}
                onRemove={() => remove(d.id)}
              />
            ))}
          </div>
        </section>

        {/* ─── B) Recherche ─────────────────────────────────────────────── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            B · Recherche réglementaire
          </h3>
          <div className="flex items-center gap-2">
            <Search size={13} className="text-gray-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Mot-clé (ex. « émergence », « bruit particulier »)"
              className="flex-1 text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {query.trim() && (
            <div className="mt-3 space-y-2">
              {hits.length === 0 ? (
                <div className="text-xs text-gray-600 italic">
                  Aucun résultat. Astuce : seuls les documents avec contenu PDF extrait sont
                  recherchables (les entrées seed sans PDF n'ont pas de texte).
                </div>
              ) : (
                hits.map((h) => (
                  <div
                    key={h.doc.id}
                    className="px-3 py-2 rounded border border-gray-800 bg-gray-900/40"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <FileText size={11} className="text-emerald-400" />
                      <span className="text-xs font-semibold text-gray-200">
                        {h.doc.title}
                      </span>
                      <span className="text-[10px] text-gray-600">{h.doc.source}</span>
                    </div>
                    <div
                      className="text-[11px] text-gray-400 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: highlightHtml(h.excerpt, query) }}
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* ─── C) Sources officielles ───────────────────────────────────── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Sources officielles
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {OFFICIAL_SOURCES.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 px-3 py-2 rounded border border-gray-800
                           bg-gray-900/30 hover:bg-gray-900/60 hover:border-gray-700 transition-colors"
              >
                <LinkIcon size={12} className="text-emerald-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-200 flex items-center gap-1">
                    {s.name}
                    <ExternalLink size={10} className="text-gray-500" />
                  </div>
                  <div className="text-[10px] text-gray-500">{s.description}</div>
                </div>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

// ─── Carte document ─────────────────────────────────────────────────────────
function DocCard({
  doc,
  onChange,
  onRemove,
}: {
  doc: RegulationDoc
  onChange: (patch: Partial<RegulationDoc>) => void
  onRemove: () => void
}) {
  const preview = doc.fullText
    ? doc.fullText.slice(0, 200).replace(/\s+/g, ' ').trim() + (doc.fullText.length > 200 ? '…' : '')
    : doc.seed
    ? 'Entrée de référence — aucun PDF importé. Consulter le lien officiel ci-dessous.'
    : 'Aucun texte extrait.'

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <input
          type="text"
          value={doc.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="flex-1 text-xs font-semibold text-gray-100 bg-transparent border-b border-transparent
                     hover:border-gray-700 focus:border-emerald-500 focus:outline-none px-0.5 py-0.5"
        />
        <span
          className={`shrink-0 px-1.5 py-0.5 text-[9px] font-semibold rounded border ${
            STATUS_BADGE[doc.status]
          }`}
        >
          {doc.status}
        </span>
        <button
          onClick={onRemove}
          className="text-gray-600 hover:text-rose-400"
          title="Supprimer"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Métadonnées éditables */}
      <div className="grid grid-cols-3 gap-1.5">
        <select
          value={doc.source}
          onChange={(e) => onChange({ source: e.target.value as RegulationSource })}
          className="text-[10px] bg-gray-800 text-gray-200 border border-gray-700 rounded px-1.5 py-0.5"
        >
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="date"
          value={doc.dateDocument}
          onChange={(e) => onChange({ dateDocument: e.target.value })}
          className="text-[10px] bg-gray-800 text-gray-200 border border-gray-700 rounded px-1.5 py-0.5"
        />
        <select
          value={doc.status}
          onChange={(e) => onChange({ status: e.target.value as RegulationStatus })}
          className="text-[10px] bg-gray-800 text-gray-200 border border-gray-700 rounded px-1.5 py-0.5"
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <p className="text-[11px] text-gray-500 leading-relaxed">{preview}</p>

      {doc.lienOfficiel && (
        <a
          href={doc.lienOfficiel}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300"
        >
          Lien officiel <ExternalLink size={9} />
        </a>
      )}
    </div>
  )
}

// ─── Highlight ──────────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string))
}
function highlightHtml(text: string, query: string): string {
  const safe = escapeHtml(text)
  const q = query.trim()
  if (!q) return safe
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return safe.replace(re, '<mark style="background:#fde68a;color:#0f172a;padding:0 2px;border-radius:2px">$1</mark>')
}
