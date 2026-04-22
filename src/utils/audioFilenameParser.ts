/**
 * Extraction de métadonnées temporelles depuis un nom de fichier audio.
 *
 * Formats reconnus (par ordre de priorité) :
 *   1. YYYY-MM-DD_HH-MM-SS        → timestamp complet
 *      ex: "2025-03-15_14-30-22.mp3"
 *   2. YYYYMMDD-HHMMSS            → timestamp compact
 *      ex: "20250315-143022.mp3"
 *   3. YYYYMMDDTHHMMSS            → ISO compact avec T
 *      ex: "20250315T143022.mp3"
 *   4. YYMMDD_NNNN                → date courte + index (fréquent sur
 *                                    les enregistreurs Zoom / Tascam / EDIROL)
 *      ex: "180720_0013.mp3"  = 2018-07-20, fichier #13
 *   5. YYYYMMDD_NNNN              → date complète + index
 *      ex: "20180720_0013.mp3" = 2018-07-20, fichier #13
 *
 * Retourne null si aucune heure extractible — l'appelant doit alors
 * demander la date/heure à l'utilisateur.
 *
 * La numéro de série d'un instrument 831C/821SE commence typiquement
 * par un segment numérique : on ne l'extrait pas ici (cf. universalParser),
 * mais on expose une fonction `extractSerialFromAudioName` pour l'auto-
 * assignation d'un fichier audio à un point de mesure.
 */

export interface AudioFilenameResult {
  /** ISO YYYY-MM-DD */
  date: string
  /** Heure du début, entre 0 et 24 (exclusif). Peut être null si seule la date est connue. */
  startMin: number | null
  /** Index séquentiel du fichier dans la journée (0001 → 1), utile pour l'ordre */
  fileIndex: number | null
  /** Degré de confiance du parsing :
   *    - 'full'      : timestamp explicite (YYYY-MM-DD_HH-MM-SS ou équivalent)
   *    - 'dateOnly'  : date ISO détectée de façon plausible (YYYY-MM-DD)
   *    - 'uncertain' : pattern YYMMDD_NNNN des enregistreurs — la date peut
   *                     être une séquence interne et non un horodatage réel
   *    - 'none'      : rien d'exploitable
   */
  detected: 'full' | 'dateOnly' | 'uncertain' | 'none'
}

function pad(n: number): string { return String(n).padStart(2, '0') }

function makeIsoDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (y < 1970 || y > 2200) return false
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  return true
}

function isValidTime(h: number, mi: number, s: number): boolean {
  return h >= 0 && h < 24 && mi >= 0 && mi < 60 && s >= 0 && s < 60
}

/**
 * Convertit une année à 2 chiffres en 4 chiffres avec l'heuristique
 * classique : 70–99 → 19xx, 00–69 → 20xx.
 */
function yearFromTwoDigits(yy: number): number {
  return yy >= 70 ? 1900 + yy : 2000 + yy
}

export function parseAudioFilename(name: string): AudioFilenameResult | null {
  // On travaille sur le nom sans extension, on normalise en minuscules
  const base = name.replace(/\.[^.]+$/, '')

  // 1. YYYY-MM-DD_HH-MM-SS (séparateurs variables : _ / - / espace / T)
  const full = base.match(
    /(\d{4})[-_](\d{2})[-_](\d{2})[\s_Tt-]+(\d{2})[-_.:](\d{2})(?:[-_.:](\d{2}))?/,
  )
  if (full) {
    const [, y, mo, d, h, mi, s] = full
    const Y = parseInt(y, 10), M = parseInt(mo, 10), D = parseInt(d, 10)
    const H = parseInt(h, 10), MI = parseInt(mi, 10), S = parseInt(s ?? '0', 10)
    if (isValidDate(Y, M, D) && isValidTime(H, MI, S)) {
      return {
        date: makeIsoDate(Y, M, D),
        startMin: H * 60 + MI + S / 60,
        fileIndex: null,
        detected: 'full',
      }
    }
  }

  // 2. YYYYMMDD-HHMMSS / YYYYMMDDHHMMSS / YYYYMMDDTHHMMSS
  const compact = base.match(/(\d{4})(\d{2})(\d{2})[-_Tt]?(\d{2})(\d{2})(\d{2})/)
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact
    const Y = parseInt(y, 10), M = parseInt(mo, 10), D = parseInt(d, 10)
    const H = parseInt(h, 10), MI = parseInt(mi, 10), S = parseInt(s, 10)
    if (isValidDate(Y, M, D) && isValidTime(H, MI, S)) {
      return {
        date: makeIsoDate(Y, M, D),
        startMin: H * 60 + MI + S / 60,
        fileIndex: null,
        detected: 'full',
      }
    }
  }

  // 3. YYYYMMDD_NNNN (enregistreurs Zoom/Tascam)
  const datePlusIndex = base.match(/(\d{4})(\d{2})(\d{2})[-_](\d{3,4})(?!\d)/)
  if (datePlusIndex) {
    const [, y, mo, d, idx] = datePlusIndex
    const Y = parseInt(y, 10), M = parseInt(mo, 10), D = parseInt(d, 10)
    if (isValidDate(Y, M, D)) {
      return {
        date: makeIsoDate(Y, M, D),
        startMin: null,
        fileIndex: parseInt(idx, 10),
        detected: 'dateOnly',
      }
    }
  }

  // 4. YYMMDD_NNNN (date courte, fréquente sur les enregistreurs Tascam/Zoom)
  //    Ce format est ambigu : "180720_0013" peut être le fichier #13 du
  //    20 juillet 2018, OU simplement un numéro interne de session. On
  //    retourne `uncertain` pour que l'UI force l'utilisateur à vérifier.
  const shortDatePlusIndex = base.match(/(^|[^\d])(\d{2})(\d{2})(\d{2})[-_](\d{3,4})(?!\d)/)
  if (shortDatePlusIndex) {
    const [, , yy, mo, d, idx] = shortDatePlusIndex
    const Y = yearFromTwoDigits(parseInt(yy, 10))
    const M = parseInt(mo, 10), D = parseInt(d, 10)
    if (isValidDate(Y, M, D)) {
      return {
        date: makeIsoDate(Y, M, D),
        startMin: null,
        fileIndex: parseInt(idx, 10),
        detected: 'uncertain',
      }
    }
  }

  // 5. Date simple ISO
  const isoOnly = base.match(/(\d{4})[-_](\d{2})[-_](\d{2})/)
  if (isoOnly) {
    const [, y, mo, d] = isoOnly
    const Y = parseInt(y, 10), M = parseInt(mo, 10), D = parseInt(d, 10)
    if (isValidDate(Y, M, D)) {
      return {
        date: makeIsoDate(Y, M, D),
        startMin: null,
        fileIndex: null,
        detected: 'dateOnly',
      }
    }
  }

  return null
}

/**
 * Tente d'extraire un numéro de série d'instrument depuis un nom de fichier
 * audio (pour auto-association à un point). Recherche d'un groupe de 6+
 * chiffres qui ne correspondent pas à une date.
 */
export function extractSerialFromAudioName(name: string, knownSerials: string[]): string | null {
  for (const s of knownSerials) {
    if (s && name.includes(s)) return s
  }
  return null
}

/**
 * Déduit les heures de début des fichiers d'une même journée quand seul
 * leur `fileIndex` est connu et que toutes les durées sont connues.
 *
 * Hypothèse : les fichiers s'enchaînent sans interruption dans l'ordre de
 * `fileIndex`, le premier fichier commence à minuit (00:00) sauf indication
 * contraire via `anchorMin` — cas standard pour les enregistreurs qui
 * découpent la journée en segments.
 *
 * Retourne une map fileId → startMin.
 */
export function deriveStartTimesFromSequence(
  entries: Array<{ id: string; date: string; fileIndex: number | null; durationSec: number }>,
  anchorMin = 0,
): Record<string, number> {
  const byDate = new Map<string, Array<{ id: string; fileIndex: number; durationSec: number }>>()
  for (const e of entries) {
    if (e.fileIndex === null) continue
    if (!byDate.has(e.date)) byDate.set(e.date, [])
    byDate.get(e.date)!.push({ id: e.id, fileIndex: e.fileIndex, durationSec: e.durationSec })
  }
  const out: Record<string, number> = {}
  for (const arr of byDate.values()) {
    arr.sort((a, b) => a.fileIndex - b.fileIndex)
    let cur = anchorMin
    for (const f of arr) {
      out[f.id] = cur
      cur += f.durationSec / 60
    }
  }
  return out
}
