/**
 * Documents réglementaires EMBARQUÉS dans l'application.
 *
 * Les trois documents normatifs ne changent jamais : ils sont déposés sous
 * `public/reglementation/`, servis en statique et donc absents du pipeline JS.
 * Ce module ne fait QUE décider — chemins, disponibilité, messages. Aucune I/O,
 * aucun accès au DOM : tout est testable en Vitest sous Node.
 *
 * ── Pourquoi une correspondance par identifiant, et pas un champ dans les seeds
 * `ensureSeeded()` ne sème qu'une fois (drapeau `acoustiq_regulations_seeded`).
 * Un champ ajouté aux entrées seed ne parviendrait JAMAIS aux postes déjà semés,
 * dont leur copie localStorage est figée. On dérive donc le chemin à la lecture,
 * depuis l'identifiant stable de l'entrée. Alignement par clé, jamais par index.
 *
 * ── Pourquoi le type de contenu, et pas seulement le statut HTTP
 * Vérifié empiriquement sur le serveur de développement : une requête vers
 * `/reglementation/inexistant.pdf` renvoie `200 OK` + `Content-Type: text/html`
 * et le corps de `index.html` (repli SPA). Une sonde fondée sur le seul statut
 * conclurait « disponible » et la visionneuse recevrait du HTML. La présence de
 * `application/pdf` est donc une condition NÉCESSAIRE, pas un confort.
 */

/** Dossier des PDF embarqués, relatif à la base de l'application. */
export const DOSSIER_PDF = 'reglementation'

/**
 * Identifiant d'entrée réglementaire → nom du fichier embarqué.
 *
 * Une entrée absente de cette table n'a délibérément pas de PDF embarqué
 * (cas de la LQE : texte consolidé en évolution continue, dont figer une copie
 * dans l'application induirait en erreur — le lien LégisQuébec fait foi).
 */
const PDF_PAR_ID: Readonly<Record<string, string>> = {
  'seed-note-instruction-98-01': 'note-instruction-98-01.pdf',
  'seed-lignes-directrices-bruit-2026': 'lignes-directrices-melccfp-2026.pdf',
  'seed-reafie-2025-11-01': 'reafie-ordonnance.pdf',
}

/** Identifiants disposant d'un PDF embarqué (ordre stable, pour les tests). */
export const IDS_AVEC_PDF: readonly string[] = Object.keys(PDF_PAR_ID)

/**
 * Chemin RELATIF du PDF embarqué d'une entrée, ou `null` si aucun n'est prévu.
 *
 * Relatif à dessein : le build Power Apps fixe `base: './'` et l'application est
 * servie depuis un sous-chemin. Un chemin absolu (`/reglementation/…`) viserait
 * la racine du domaine et échouerait en production tout en fonctionnant en
 * Local Play — exactement le genre de piège « vert en dev, cassé en prod ».
 */
export function cheminPdf(id: string): string | null {
  const nom = PDF_PAR_ID[id]
  return nom ? `${DOSSIER_PDF}/${nom}` : null
}

/** Nom de fichier proposé au téléchargement (F4). */
export function nomTelechargement(id: string): string | null {
  return PDF_PAR_ID[id] ?? null
}

/** Résout le chemin relatif contre la base du document. */
export function urlPdf(cheminRelatif: string, baseUri: string): string {
  return new URL(cheminRelatif, baseUri).href
}

// ─── Machine à états de disponibilité ───────────────────────────────────────

export type EtatPdf =
  /** Aucun PDF embarqué prévu pour cette entrée. Fait de donnée. */
  | 'non-embarque'
  /** Sonde en cours. */
  | 'verification'
  /** Fichier présent et bien typé `application/pdf`. */
  | 'disponible'
  /** Le fichier n'est pas déployé. Fait de donnée. */
  | 'absent'
  /** La sonde n'a pas abouti. Échec technique — ne dit RIEN sur le fichier. */
  | 'echec-reseau'

/** États terminaux atteignables par une sonde. */
export type EtatSonde = Extract<EtatPdf, 'disponible' | 'absent' | 'echec-reseau'>

/** Ce que la sonde retient d'une réponse HTTP. `null` = la requête a échoué. */
export interface ReponseSonde {
  readonly status: number
  readonly contentType: string | null
}

export interface ResultatSonde {
  readonly etat: EtatSonde
  /** Motif technique court, destiné à être montré — jamais avalé en silence. */
  readonly detail: string
}

const TYPE_PDF = 'application/pdf'

/**
 * Classe une réponse de sonde. FONCTION PURE — cœur testable de F5.
 *
 * Distingue strictement le FAIT DE DONNÉE (le fichier n'est pas là) de l'ÉCHEC
 * TECHNIQUE (on n'a pas pu savoir). Un 404 est un fait ; une coupure réseau ou
 * un 500 est un échec. Les deux conservent le lien officiel, mais ne se disent
 * pas de la même façon à l'utilisateur.
 */
export function classerSonde(reponse: ReponseSonde | null): ResultatSonde {
  if (reponse === null) {
    return { etat: 'echec-reseau', detail: 'requête de vérification non aboutie' }
  }
  const { status, contentType } = reponse

  if (status === 200) {
    const type = (contentType ?? '').toLowerCase()
    if (type.includes(TYPE_PDF)) {
      return { etat: 'disponible', detail: `HTTP 200 · ${TYPE_PDF}` }
    }
    if (!contentType) {
      return { etat: 'absent', detail: 'HTTP 200 sans type de contenu déclaré' }
    }
    // Cas central du repli SPA : le serveur a répondu 200 avec index.html.
    return {
      etat: 'absent',
      detail: `HTTP 200 mais type « ${contentType} » — repli du serveur, le fichier n'est pas déployé`,
    }
  }

  if (status === 404 || status === 410) {
    return { etat: 'absent', detail: `HTTP ${status}` }
  }

  // 401, 403, 5xx, redirections non suivies… : on ne sait pas, on ne conclut pas.
  return { etat: 'echec-reseau', detail: `HTTP ${status}` }
}

/** Vrai seulement si la visionneuse peut être ouverte. */
export function estConsultable(etat: EtatPdf): boolean {
  return etat === 'disponible'
}

/**
 * Message affiché sous une entrée dont le PDF n'est pas consultable.
 * Chaîne vide quand il n'y a rien à dire (`disponible`).
 */
export function motifIndisponibilite(etat: EtatPdf, detail = ''): string {
  const suffixe = detail ? ` (${detail})` : ''
  switch (etat) {
    case 'disponible':
      return ''
    case 'verification':
      return 'Vérification de la disponibilité du document embarqué…'
    case 'non-embarque':
      return 'Aucun PDF embarqué pour cette entrée — le lien officiel fait foi.'
    case 'absent':
      return `PDF non embarqué dans cette version de l'application — consulter le lien officiel${suffixe}.`
    case 'echec-reseau':
      return `Disponibilité invérifiable — échec technique, et non absence constatée. Consulter le lien officiel${suffixe}.`
  }
}

/**
 * Libellé court d'état, doublant systématiquement la couleur du badge.
 * La couleur ne porte jamais l'information seule.
 */
export function libelleEtat(etat: EtatPdf): string {
  switch (etat) {
    case 'disponible':
      return 'Embarqué'
    case 'verification':
      return 'Vérification…'
    case 'non-embarque':
      return 'Lien officiel'
    case 'absent':
      return 'Non embarqué'
    case 'echec-reseau':
      return 'Invérifiable'
  }
}

/** État initial d'une entrée, avant toute sonde. */
export function etatInitial(id: string): EtatPdf {
  return cheminPdf(id) === null ? 'non-embarque' : 'verification'
}
