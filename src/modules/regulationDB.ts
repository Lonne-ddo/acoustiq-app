/**
 * Base de données réglementaire (stockée dans localStorage).
 *
 * Stocke des documents (PDF téléversés ou entrées seed sans contenu) avec
 * leur texte intégral découpé en chunks d'environ 400 mots, pour permettre
 * une recherche plein-texte et — à terme — une recherche vectorielle.
 *
 * TODO: When AI is integrated, use regulatoryDB.search(query) to retrieve
 * relevant regulatory context before generating advice. Each chunk should
 * be < 500 tokens for optimal retrieval.
 */

export type RegulationSource =
  | 'REAFIE'
  | 'Lignes directrices MELCCFP'
  | 'LQE'
  | 'ISO'
  | 'Autre'

export type RegulationStatus = 'En vigueur' | 'Remplacé' | 'Archivé'

export interface RegulationChunk {
  /** Index du chunk dans le document */
  i: number
  /** Texte du chunk (~400 mots) */
  text: string
}

export interface RegulationDoc {
  id: string
  filename: string
  title: string
  source: RegulationSource
  /** Date d'ajout à la base (ISO) */
  dateAdded: string
  /** Date du document officiel (YYYY-MM-DD), vide si inconnue */
  dateDocument: string
  status: RegulationStatus
  /** Texte complet (vide pour les entrées seed sans PDF) */
  fullText: string
  /** Découpage en chunks pour la recherche */
  chunks: RegulationChunk[]
  /** Lien officiel vers la source (ex. LégisQuébec) */
  lienOfficiel?: string
  /** Vrai pour les entrées pré-chargées (lien officiel sans PDF) */
  seed?: boolean
}

const STORAGE_KEY = 'acoustiq_regulations'
const SEED_FLAG_KEY = 'acoustiq_regulations_seeded'

// ─── Chunking : ~400 mots par chunk ─────────────────────────────────────────
const CHUNK_WORDS = 400

export function chunkText(text: string, size = CHUNK_WORDS): RegulationChunk[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const out: RegulationChunk[] = []
  for (let i = 0; i < words.length; i += size) {
    out.push({ i: out.length, text: words.slice(i, i + size).join(' ') })
  }
  return out
}

// ─── CRUD ───────────────────────────────────────────────────────────────────
export function loadAll(): RegulationDoc[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function saveAll(docs: RegulationDoc[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs))
  } catch (err) {
    console.error('Sauvegarde réglementation échouée (quota ?) :', err)
    throw err
  }
}

export function addDoc(doc: RegulationDoc): RegulationDoc[] {
  const all = loadAll()
  const next = [doc, ...all]
  saveAll(next)
  return next
}

export function updateDoc(id: string, patch: Partial<RegulationDoc>): RegulationDoc[] {
  const all = loadAll().map((d) => (d.id === id ? { ...d, ...patch } : d))
  saveAll(all)
  return all
}

export function removeDoc(id: string): RegulationDoc[] {
  const all = loadAll().filter((d) => d.id !== id)
  saveAll(all)
  return all
}

// ─── Recherche plein texte ──────────────────────────────────────────────────
export interface SearchHit {
  doc: RegulationDoc
  /** Extrait avec mots-clés mis en évidence (préfixé/suffixé par …) */
  excerpt: string
  /** Position du premier match dans fullText */
  matchAt: number
}

/**
 * Recherche plein-texte dans tous les documents.
 * Retourne au plus une occurrence par document (meilleure correspondance).
 */
export function searchDocs(
  query: string,
  options: { source?: RegulationSource | 'all'; activeOnly?: boolean } = {},
): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const all = loadAll()
  const out: SearchHit[] = []
  for (const doc of all) {
    if (options.activeOnly && doc.status !== 'En vigueur') continue
    if (options.source && options.source !== 'all' && doc.source !== options.source) continue
    const text = doc.fullText
    if (!text) continue
    const idx = text.toLowerCase().indexOf(q)
    if (idx < 0) continue
    const start = Math.max(0, idx - 80)
    const end = Math.min(text.length, idx + q.length + 120)
    const excerpt =
      (start > 0 ? '…' : '') +
      text.slice(start, end).replace(/\s+/g, ' ').trim() +
      (end < text.length ? '…' : '')
    out.push({ doc, excerpt, matchAt: idx })
  }
  return out
}

// ─── Seed initial ───────────────────────────────────────────────────────────
const SEED_DOCS: Omit<RegulationDoc, 'dateAdded'>[] = [
  {
    id: 'seed-reafie-2025-11-01',
    filename: 'reafie-q-2-r-17-1.pdf',
    title: 'REAFIE Q-2 r.17.1',
    source: 'REAFIE',
    dateDocument: '2025-11-01',
    status: 'En vigueur',
    fullText: '',
    chunks: [],
    lienOfficiel: 'https://www.legisquebec.gouv.qc.ca/fr/document/rc/Q-2,%20r.%2017.1',
    seed: true,
  },
  {
    id: 'seed-lignes-directrices-bruit-2026',
    filename: 'lignes-directrices-bruit-melccfp-2026.pdf',
    title: 'Lignes directrices bruit MELCCFP 2026',
    source: 'Lignes directrices MELCCFP',
    dateDocument: '2026-01-13',
    status: 'En vigueur',
    fullText: '',
    chunks: [],
    lienOfficiel:
      'https://www.environnement.gouv.qc.ca/publications/notes-instructions/98-01/lignes-directrices-bruit-2026.pdf',
    seed: true,
  },
  {
    id: 'seed-lqe-q-2',
    filename: 'lqe-q-2.pdf',
    title: 'LQE — chapitre Q-2 (Loi sur la qualité de l\'environnement)',
    source: 'LQE',
    dateDocument: '',
    status: 'En vigueur',
    fullText: '',
    chunks: [],
    lienOfficiel: 'https://www.legisquebec.gouv.qc.ca/fr/document/lc/Q-2',
    seed: true,
  },
]

/** Au premier lancement, insère les entrées seed (sans contenu). */
export function ensureSeeded(): RegulationDoc[] {
  if (localStorage.getItem(SEED_FLAG_KEY) === '1') return loadAll()
  const existing = loadAll()
  const existingIds = new Set(existing.map((d) => d.id))
  const now = new Date().toISOString()
  const toAdd = SEED_DOCS.filter((s) => !existingIds.has(s.id)).map(
    (s): RegulationDoc => ({ ...s, dateAdded: now }),
  )
  const next = [...existing, ...toAdd]
  saveAll(next)
  localStorage.setItem(SEED_FLAG_KEY, '1')
  return next
}

// ─── Sources officielles (panneau de liens externes) ────────────────────────
export const OFFICIAL_SOURCES: Array<{
  name: string
  url: string
  description: string
}> = [
  {
    name: 'LégisQuébec',
    url: 'https://www.legisquebec.gouv.qc.ca',
    description: 'Tous les règlements du Québec, à jour en continu',
  },
  {
    name: 'CanLII',
    url: 'https://www.canlii.org',
    description: 'Lois fédérales et provinciales, accès gratuit',
  },
  {
    name: 'Données Québec',
    url: 'https://www.donneesquebec.ca',
    description: 'Données environnementales ouvertes',
  },
  {
    name: 'Gazette officielle du Québec',
    url: 'https://www.publicationsduquebec.gouv.qc.ca',
    description: 'Journal officiel du gouvernement québécois',
  },
]
