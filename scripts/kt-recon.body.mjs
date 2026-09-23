/**
 * Corps de `kt-recon.mjs` — importé APRÈS l'enregistrement du hook de
 * résolution, sans quoi les imports `src/*.ts` ci-dessous échoueraient.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseWorkbook } from '../src/modules/formatDetectors.ts'
import { parseCsv, isResumeName, pairResume } from '../src/modules/csvParser.ts'
import { analyzeKt, laeqAvg, KT_BAND_FREQS } from '../src/utils/acoustics.ts'

const ROOT = new URL('..', import.meta.url)
const ROOT_DIR = decodeURIComponent(ROOT.pathname).replace(/^\/([A-Za-z]:)/, '$1')
const DATA_DIR = path.join(ROOT_DIR, '.local-data')

/**
 * Fenêtre d'évaluation RÉELLE de l'UI à l'ouverture d'un fichier, recopiée
 * depuis Conformite2026.tsx : `evalHour` vaut '14:00' (:169), la fenêtre est
 * [evalHour, evalHour + 60 min[ (:234-235), appliquée sur `d.t % 1440`
 * (:240-246). `evalHour` n'est jamais recalé sur le contenu du fichier — c'est
 * un état de composant, que seul l'input (:673) modifie.
 */
const EVAL_START = 14 * 60
const EVAL_END = EVAL_START + 60

const f1 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(1) : String(x))

/**
 * `analyzeKt` de `main`, extraite par `git show` dans un fichier TEMPORAIRE hors
 * de `src/`, jamais commité. Le module n'a qu'un import `type` (effacé à
 * l'exécution) : une copie isolée suffit, aucune arborescence à reconstituer.
 * Retourne null si la ref est introuvable (clone sans `origin/main` à jour).
 */
async function loadMainAnalyzeKt() {
  let src
  for (const ref of ['origin/main', 'main']) {
    try {
      src = execFileSync('git', ['show', ref + ':src/utils/acoustics.ts'], {
        cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 32 << 20,
      })
      break
    } catch { /* ref suivante */ }
  }
  if (!src) return null
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kt-recon-')), 'acoustics.main.ts')
  fs.writeFileSync(tmp, src)
  const mod = await import('file:///' + tmp.replace(/\\/g, '/'))
  return mod.analyzeKt
}

/** Reproduit la chaîne UI : fenêtre → spectre moyen énergétique → analyzeKt. */
function ktSurFenetre(mf, ktMain) {
  const inWindow = mf.data.filter((d) => {
    const m = ((d.t % 1440) + 1440) % 1440
    return m >= EVAL_START && m < EVAL_END
  })
  const out = { nTotal: mf.data.length, nWindow: inWindow.length }
  if (inWindow.length === 0) return out
  out.ba = laeqAvg(inWindow.map((d) => d.laeq))                       // :272
  const specs = inWindow.map((d) => d.spectra).filter(Boolean)
  out.nSpecs = specs.length
  if (specs.length === 0) return out
  const nBands = specs[0].length                                      // :294-300
  out.avgSpec = Array.from({ length: nBands }, (_, i) =>
    laeqAvg(specs.map((s) => s[i]).filter((v) => typeof v === 'number')))
  out.branche = analyzeKt(out.avgSpec, out.ba, mf.spectraFreqs)       // :303
  out.main = ktMain ? ktMain(out.avgSpec, out.ba, mf.spectraFreqs) : null
  return out
}

function rapport(name, mf, r) {
  const L = ['### ' + name]
  L.push('  lignes           : ' + r.nTotal + ' | date parsée : ' + mf.date)
  L.push('  spectraSource    : ' + (mf.spectraSource ?? '—')
    + (mf.spectraUnavailable ? ' | BLOQUÉ : ' + mf.spectraUnavailable : ''))
  const nf = mf.spectraFreqs?.length ?? 0
  L.push('  bandes           : ' + nf + (nf ? ', ' + mf.spectraFreqs[0] + ' → ' + mf.spectraFreqs[nf - 1] + ' Hz' : ''))
  L.push('  fenêtre [14:00,15:00) : ' + r.nWindow + ' points'
    + (r.nWindow ? ', ' + (r.nSpecs ?? 0) + ' avec spectre' : ''))
  if (!r.nWindow) {
    L.push('  → fenêtre VIDE : sortie anticipée Conformite2026.tsx:248, aucun Kt.')
    return L.join('\n')
  }
  if (!r.avgSpec) {
    L.push('  → aucun spectre dans la fenêtre.')
    return L.join('\n')
  }
  L.push('  Ba (LAeq fenêtre): ' + f1(r.ba) + ' dB(A)')
  L.push('  MAIN             : ' + (!r.main
    ? 'non comparé (ref git introuvable)'
    : r.main.unavailable
      ? 'REFUS [' + r.main.unavailable.reason + '] ' + r.main.unavailable.message
      : 'Kt = ' + r.main.kt + ' dB'))

  const b = r.branche
  if (b.unavailable) {
    L.push('  BRANCHE          : REFUS [' + b.unavailable.reason + '] ' + b.unavailable.message)
    return L.join('\n')
  }
  L.push('  BRANCHE          : Kt = ' + b.kt + ' dB')

  L.push('')
  L.push('  Spectre LZeq moyen BRUT, tel que parsé :')
  mf.spectraFreqs.forEach((f, i) => {
    const k = KT_BAND_FREQS.indexOf(f)
    L.push('    idx ' + String(i).padStart(2) + '  ' + String(f).padStart(7) + ' Hz  '
      + f1(r.avgSpec[i]).padStart(7) + ' dB'
      + (k >= 0 ? "   ← bande d'analyse n°" + (k + 1) : ''))
  })

  L.push('')
  L.push("  Spectre LZeq réaligné PAR FRÉQUENCE sur les 24 bandes d'analyse (Hz → dB) :")
  L.push('    ' + b.bands.map((x) => x.freq + ':' + f1(x.lzeq)).join('  '))

  const detail = (i, titre) => {
    const t = b.bands[i], p = b.bands[i - 1], n = b.bands[i + 1]
    L.push('')
    L.push('  ' + titre)
    L.push('    voisine basse ' + String(p.freq).padStart(5) + ' Hz : LZeq = ' + f1(p.lzeq) + ' dB')
    L.push('    BANDE         ' + String(t.freq).padStart(5) + ' Hz : LZeq = ' + f1(t.lzeq)
      + ' dB | A(f) = ' + f1(t.laeqBand - t.lzeq) + ' dB | LAeq_bande = ' + f1(t.laeqBand) + ' dB(A)')
    L.push('    voisine haute ' + String(n.freq).padStart(5) + ' Hz : LZeq = ' + f1(n.lzeq) + ' dB')
    L.push('    Δprec = ' + f1(t.diffPrev) + '  Δsuiv = ' + f1(t.diffNext)
      + '  seuil = ' + t.threshold + ' dB  → min(Δ) = ' + f1(Math.min(t.diffPrev, t.diffNext)))
    L.push('    exclusion « bande masquée » : Ba − LAeq_bande = ' + f1(r.ba - t.laeqBand)
      + ' dB (≥ 15 ⇒ exclue) → excluded = ' + t.excluded)
  }

  if (b.triggeringIndex !== null) {
    detail(b.triggeringIndex,
      'BANDE TONALE : ' + b.bands[b.triggeringIndex].freq + " Hz (bande d'analyse n°"
      + (b.triggeringIndex + 1) + ')')
  } else {
    // Aucune bande tonale : on montre quand même la plus proche du critère, pour
    // que le verdict « Kt = 0 » soit vérifiable à la main et non pris sur parole.
    const best = b.bands
      .filter((x) => !x.isBoundary)
      .map((x) => ({ x, marge: Math.min(x.diffPrev, x.diffNext) - x.threshold }))
      .sort((u, v) => v.marge - u.marge)[0]
    detail(b.bands.indexOf(best.x),
      'AUCUNE BANDE TONALE. Bande la plus proche du critère : ' + best.x.freq
      + ' Hz (marge ' + f1(best.marge) + ' dB)')
  }
  return L.join('\n')
}

export async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error('Aucun dossier .local-data/ à la racine du dépôt.')
    console.error('Créez-le et déposez-y les fichiers de mesure (il est gitignoré).')
    process.exitCode = 1
    return
  }
  const names = fs.readdirSync(DATA_DIR).filter((n) => /\.(csv|xlsx)$/i.test(n)).sort()
  if (names.length === 0) {
    console.error('.local-data/ ne contient aucun .csv ni .xlsx.')
    process.exitCode = 1
    return
  }
  const ktMain = await loadMainAnalyzeKt()
  if (!ktMain) console.error('⚠ analyzeKt de main introuvable — verdict MAIN omis.\n')

  const csvNames = names.filter((n) => /\.csv$/i.test(n))
  const synthese = []

  for (const name of names) {
    // Résumé.csv : métadonnées d'un « Histoire du temps », jamais chargé seul
    // (App.tsx:3399).
    if (isResumeName(name)) continue
    try {
      let mf
      if (/\.csv$/i.test(name)) {
        const blob = new Blob([fs.readFileSync(path.join(DATA_DIR, name))])
        const rName = pairResume(name, csvNames)                     // App.tsx:3400
        const rBlob = rName ? new Blob([fs.readFileSync(path.join(DATA_DIR, rName))]) : undefined
        mf = await parseCsv(blob, name, rBlob)
      } else {
        const buf = fs.readFileSync(path.join(DATA_DIR, name))
        mf = parseWorkbook(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name)
      }
      const r = ktSurFenetre(mf, ktMain)
      console.log(rapport(name, mf, r) + '\n')
      synthese.push({ name, r })
    } catch (e) {
      console.log('### ' + name + '\n  ERREUR : ' + e.message + '\n')
    }
  }

  console.log('='.repeat(72))
  console.log('SYNTHÈSE')
  for (const { name, r } of synthese) {
    const m = !r.main ? 'n/a' : r.main.unavailable ? 'REFUS' : 'Kt=' + r.main.kt
    const b = !r.branche ? 'n/a'
      : r.branche.unavailable ? 'REFUS[' + r.branche.unavailable.reason + ']'
        : 'Kt=' + r.branche.kt + (r.branche.triggeringIndex !== null
          ? ' @' + r.branche.bands[r.branche.triggeringIndex].freq + 'Hz' : '')
    console.log('  ' + name.padEnd(56) + ' main=' + m.padEnd(7) + ' branche=' + b)
  }
}
