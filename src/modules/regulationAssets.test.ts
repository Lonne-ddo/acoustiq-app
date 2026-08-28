import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import {
  IDS_AVEC_PDF,
  DOSSIER_PDF,
  cheminPdf,
  nomTelechargement,
  urlPdf,
  classerSonde,
  estConsultable,
  etatInitial,
  libelleEtat,
  motifIndisponibilite,
  type EtatPdf,
} from './regulationAssets'
import { seedsAAjouter, type RegulationDoc } from './regulationDB'

const TOUS_LES_ETATS: EtatPdf[] = [
  'non-embarque',
  'verification',
  'disponible',
  'absent',
  'echec-reseau',
]

// ─── T1 — PDF présent ───────────────────────────────────────────────────────
describe('T1 — PDF embarqué présent', () => {
  it('200 + application/pdf ⇒ disponible, donc consultable', () => {
    const r = classerSonde({ status: 200, contentType: 'application/pdf' })
    expect(r.etat).toBe('disponible')
    expect(estConsultable(r.etat)).toBe(true)
  })

  it('accepte les paramètres et la casse du type de contenu', () => {
    expect(classerSonde({ status: 200, contentType: 'application/pdf; charset=binary' }).etat).toBe(
      'disponible',
    )
    expect(classerSonde({ status: 200, contentType: 'APPLICATION/PDF' }).etat).toBe('disponible')
  })

  it('les trois documents normatifs ont un chemin et un nom de téléchargement', () => {
    expect(IDS_AVEC_PDF).toEqual([
      'seed-note-instruction-98-01',
      'seed-lignes-directrices-bruit-2026',
      'seed-reafie-2025-11-01',
    ])
    for (const id of IDS_AVEC_PDF) {
      const chemin = cheminPdf(id)
      expect(chemin).toBeTruthy()
      expect(chemin!.startsWith(`${DOSSIER_PDF}/`)).toBe(true)
      // Chemin RELATIF : un chemin absolu viserait la racine du domaine et
      // casserait sous Power Apps, dont le build fixe base './'.
      expect(chemin!.startsWith('/')).toBe(false)
      expect(nomTelechargement(id)).toMatch(/\.pdf$/)
    }
  })

  it('résout l’URL contre une base en sous-chemin, sans viser la racine', () => {
    const url = urlPdf('reglementation/x.pdf', 'https://apps.powerapps.com/play/e/abc/app/def/')
    expect(url).toBe('https://apps.powerapps.com/play/e/abc/app/def/reglementation/x.pdf')
  })
})

// ─── T2 — PDF absent ────────────────────────────────────────────────────────
describe('T2 — PDF absent : motif explicite, jamais de refus silencieux', () => {
  it('404 ⇒ absent (fait de donnée)', () => {
    const r = classerSonde({ status: 404, contentType: 'text/plain' })
    expect(r.etat).toBe('absent')
    expect(r.detail).toContain('404')
    expect(estConsultable(r.etat)).toBe(false)
  })

  it('410 ⇒ absent', () => {
    expect(classerSonde({ status: 410, contentType: null }).etat).toBe('absent')
  })

  /**
   * Le cas pivot, constaté empiriquement sur le serveur de développement :
   * une requête vers un fichier inexistant sous public/ renvoie
   * `200 OK` + `Content-Type: text/html` + le corps de index.html (repli SPA).
   * Une sonde fondée sur le seul statut conclurait « disponible » et la
   * visionneuse recevrait du HTML.
   */
  it('200 + text/html (repli SPA) ⇒ absent, PAS disponible', () => {
    const r = classerSonde({ status: 200, contentType: 'text/html' })
    expect(r.etat).toBe('absent')
    expect(estConsultable(r.etat)).toBe(false)
    expect(r.detail).toContain('text/html')
    expect(r.detail).toMatch(/repli/i)
  })

  it('200 sans type de contenu ⇒ absent', () => {
    expect(classerSonde({ status: 200, contentType: null }).etat).toBe('absent')
    expect(classerSonde({ status: 200, contentType: '' }).etat).toBe('absent')
  })

  it('un motif non vide accompagne tout état non consultable', () => {
    for (const etat of TOUS_LES_ETATS) {
      const motif = motifIndisponibilite(etat, 'HTTP 404')
      if (etat === 'disponible') expect(motif).toBe('')
      else expect(motif.length).toBeGreaterThan(0)
    }
  })

  it('distingue le FAIT DE DONNÉE de l’ÉCHEC TECHNIQUE', () => {
    // 5xx, 403, coupure réseau : on ne sait pas — on ne déclare pas « absent ».
    expect(classerSonde({ status: 500, contentType: null }).etat).toBe('echec-reseau')
    expect(classerSonde({ status: 403, contentType: null }).etat).toBe('echec-reseau')
    expect(classerSonde(null).etat).toBe('echec-reseau')

    const absent = motifIndisponibilite('absent', 'HTTP 404')
    const echec = motifIndisponibilite('echec-reseau', 'HTTP 500')
    expect(absent).not.toBe(echec)
    expect(echec).toMatch(/échec technique/i)
    expect(echec).not.toMatch(/non embarqué/i)
  })

  it('tout état porte un libellé textuel — la couleur ne suffit jamais', () => {
    for (const etat of TOUS_LES_ETATS) {
      expect(libelleEtat(etat).trim().length).toBeGreaterThan(0)
    }
  })

  it('une entrée sans PDF prévu (LQE) n’est jamais sondée ni consultable', () => {
    expect(cheminPdf('seed-lqe-q-2')).toBeNull()
    expect(nomTelechargement('seed-lqe-q-2')).toBeNull()
    expect(etatInitial('seed-lqe-q-2')).toBe('non-embarque')
    expect(estConsultable('non-embarque')).toBe(false)
    expect(motifIndisponibilite('non-embarque')).toMatch(/lien officiel/i)
  })

  it('un document téléversé n’a pas de PDF embarqué', () => {
    expect(cheminPdf('doc-1712345678-ab12')).toBeNull()
    expect(etatInitial('doc-1712345678-ab12')).toBe('non-embarque')
  })
})

// ─── T3 — Démarrage à froid ─────────────────────────────────────────────────
describe('T3 — aucun téléchargement de PDF avant le clic', () => {
  const tab = fs.readFileSync('src/components/RegulationTab.tsx', 'utf8')

  it('la visionneuse est en lazy : son code ne part qu’au premier clic', () => {
    expect(tab).toMatch(/lazy\(\(\)\s*=>\s*import\('\.\/PdfViewer'\)\)/)
  })

  it('la sonde est un HEAD, dans un effet — jamais au chargement du module', () => {
    expect(tab).toMatch(/method:\s*'HEAD'/)
    const avantEffet = tab.slice(0, tab.indexOf("method: 'HEAD'"))
    expect(avantEffet).toMatch(/useEffect\(/)
  })

  it('l’onglet ne monte que si l’onglet réglementation est actif', () => {
    const app = fs.readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/effectiveTab === 'regulation' && \(/)
  })

  it('seuls les identifiants réellement associés à un PDF sont sondés', () => {
    // Une entrée non associée renvoie null : aucune requête n’est possible.
    expect(IDS_AVEC_PDF).toHaveLength(3)
    expect(IDS_AVEC_PDF.every((id) => cheminPdf(id) !== null)).toBe(true)
  })

  it('aucune <iframe> ni <embed> : X-Frame-Options DENY les bloquerait en prod', () => {
    const viewer = fs.readFileSync('src/components/PdfViewer.tsx', 'utf8')
    // Le code seul : les commentaires expliquent justement pourquoi on les évite.
    const code = viewer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/<iframe/i)
    expect(code).not.toMatch(/<embed/i)
    expect(code).toMatch(/canvasContext/)
  })
})

// ─── T4 — Non-régression ────────────────────────────────────────────────────
describe('T4 — non-régression du semis et des entrées existantes', () => {
  const seedMinimal = (id: string): RegulationDoc => ({
    id,
    filename: 'x.pdf',
    title: 'x',
    source: 'Autre',
    dateAdded: 'D',
    dateDocument: '',
    status: 'En vigueur',
    fullText: '',
    chunks: [],
  })

  it('base vide ⇒ les quatre entrées de référence sont semées', () => {
    const ajouts = seedsAAjouter([], 'D')
    expect(ajouts.map((d) => d.id)).toEqual([
      'seed-note-instruction-98-01',
      'seed-reafie-2025-11-01',
      'seed-lignes-directrices-bruit-2026',
      'seed-lqe-q-2',
    ])
    expect(ajouts.every((d) => d.dateAdded === 'D')).toBe(true)
  })

  it('alignement PAR IDENTIFIANT : n’ajoute que ce qui manque, sans doublon', () => {
    const existants = [
      seedMinimal('seed-reafie-2025-11-01'),
      seedMinimal('seed-lignes-directrices-bruit-2026'),
      seedMinimal('seed-lqe-q-2'),
    ]
    const ajouts = seedsAAjouter(existants, 'D')
    expect(ajouts.map((d) => d.id)).toEqual(['seed-note-instruction-98-01'])
  })

  it('rien à ajouter quand tout est déjà présent', () => {
    const tous = seedsAAjouter([], 'D')
    expect(seedsAAjouter(tous, 'E')).toEqual([])
  })

  it('un document téléversé ne perturbe pas la réconciliation', () => {
    const ajouts = seedsAAjouter([seedMinimal('doc-999-zz')], 'D')
    expect(ajouts).toHaveLength(4)
    expect(ajouts.map((d) => d.id)).not.toContain('doc-999-zz')
  })

  it('la LQE reste une entrée à lien officiel, sans PDF embarqué', () => {
    const lqe = seedsAAjouter([], 'D').find((d) => d.id === 'seed-lqe-q-2')
    expect(lqe?.lienOfficiel).toContain('legisquebec')
    expect(cheminPdf(lqe!.id)).toBeNull()
  })

  it('la Note 98-01 est un cadre distinct des Lignes directrices 2026', () => {
    const ajouts = seedsAAjouter([], 'D')
    const note = ajouts.find((d) => d.id === 'seed-note-instruction-98-01')
    const ld = ajouts.find((d) => d.id === 'seed-lignes-directrices-bruit-2026')
    expect(note?.source).toBe('Note 98-01')
    expect(ld?.source).toBe('Lignes directrices MELCCFP')
    expect(note?.status).toBe('Remplacé')
    expect(ld?.status).toBe('En vigueur')
  })

  it('téléversement, filtres et recherche restent intacts', () => {
    const tab = fs.readFileSync('src/components/RegulationTab.tsx', 'utf8')
    expect(tab).toMatch(/extractPdfText\(buf\)/)
    expect(tab).toMatch(/Quota localStorage dépassé/)
    expect(tab).toMatch(/searchDocs\(query, \{ source: filterSource, activeOnly \}\)/)
    expect(tab).toMatch(/En vigueur seulement/)
    expect(tab).toMatch(/OFFICIAL_SOURCES\.map/)
  })
})
