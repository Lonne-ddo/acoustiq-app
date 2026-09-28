#!/usr/bin/env node
/**
 * Contrôle par MUTATION du golden et des tests de couverture de la fenêtre
 * LAr,1h — voir README.md.
 *
 *     node scripts/golden-fenetre/mutations.mjs
 *
 * Copie le projet dans un dossier TEMPORAIRE hors dépôt (node_modules relié par
 * jonction), y applique UNE mutation à la fois dans conformiteFenetre.ts, rejoue
 * les deux fichiers de test, et compte les tests qui tombent. Le dépôt n'est
 * jamais modifié.
 *
 * Code de sortie 1 si une mutation NON déclarée équivalente survit (un calcul
 * qu'on peut casser sans qu'aucun test bronche), ou si une mutation déclarée
 * équivalente fait tomber des tests (la déclaration est fausse).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'))
const CIBLE = 'src/utils/conformiteFenetre.ts'
const TESTS = {
  golden: 'src/utils/conformiteFenetre.golden.test.ts',
  couverture: 'src/utils/conformiteFenetre.couverture.test.ts',
}

/**
 * [nom, motif exact (unique dans la cible), remplacement, équivalente?]
 * G = grandeurs du golden (Ba, Bp, K, LAr, verdict) ; C = couverture.
 */
const MUTATIONS = [
  ['G1 fenêtre de 59 min', 'const evalEnd = evalStart + 60', 'const evalEnd = evalStart + 59'],
  ['G2 bornes de fenêtre ]a, b]', 'm >= evalStart && m < evalEnd', 'm > evalStart && m <= evalEnd'],
  ['G3 périodes ignorées', '.flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories))', '.flatMap((f) => f.data)'],
  ['G4 Ba en moyenne arithmétique', 'const ba = laeqAvg(inWindow.map((d) => d.laeq))', 'const ba = inWindow.reduce((s, d) => s + d.laeq, 0) / inWindow.length'],
  ['G5 seuil Bp 3 → 2 dB', 'ba - br < 3', 'ba - br < 2',
    'équivalente : extractBp (acoustics.ts) refait le test « < 3 » et renvoie null — même bpReason'],
  ['G6 Kt manuel ignoré', 'if (manualKt !== undefined && manualKt !== null) {', 'if (false) {'],
  ['G7 spectre moyen arithmétique', 'return laeqAvg(vals)', 'return vals.reduce((a, b) => a + b, 0) / vals.length'],
  ['G8 Kb forcé à 0', 'kb = computeKb(laeqAvg(lceqs), ba)', 'kb = 0'],
  ['G9 Ki manuel ignoré', 'if (manualKi !== undefined && manualKi !== null) ki = manualKi', ''],
  ['G10 Ks omis du LAr', 'computeLar1h(bp, kt, ki, kb, ks)', 'computeLar1h(bp, kt, ki, kb, 0)'],
  ['G11 critère = limite seule', 'const criterion = br !== null ? Math.max(br, limit) : limit', 'const criterion = limit'],
  ['G12 verdict < au lieu de <=', 'lar <= criterion', 'lar < criterion'],
  ['G13 libellé du K appliqué', 'if (appliedK === ks && ksEnabled)', 'if (false)'],
  ['C1 pas unique de 1 min', 'const pas = pasFichierMin(f.data)', 'const pas = 1'],
  ['C2 météo confondue avec manuelle', '? EXCL_METEO : EXCL_MANUELLE', '? EXCL_MANUELLE : EXCL_MANUELLE'],
  ['C3 priorité des statuts ignorée', 'if (statut > secondes[s])', 'if (true)'],
  ['C4 borne de période fermée', 'ts >= p.startMs && ts < p.endMs', 'ts >= p.startMs && ts <= p.endMs'],
  ['C5 hors inclusion compté retenu', 'statut = HORS_INCLUSION', 'statut = RETENUE'],
  ['C6 séparateur du libellé', "` — ${detail}`", "` - ${detail}`"],
  ['C7 retenues au plus proche', 'const retenuesMin = Math.floor(retenuesS / 60)', 'const retenuesMin = Math.round(retenuesS / 60)'],
  ['C8 plus fort reste ignoré', '.sort((a, b) => (manquantesS[b] % 60) - (manquantesS[a] % 60))', '.sort(() => 0)'],
  ['C9 cause de < 1 min tue', 'c.manquantesMin[k] > 0 || c.secondes.manquantes[k] > 0', 'c.manquantesMin[k] > 0'],
  ['C10 reste non réparti', 'manquantesMin[k]++', 'manquantesMin[k] += 0'],
]

const EXCLUS = new Set(['node_modules', '.git', '.local-data', 'dist'])

function copie() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutations-fenetre-'))
  for (const e of fs.readdirSync(ROOT)) {
    if (EXCLUS.has(e)) continue
    fs.cpSync(path.join(ROOT, e), path.join(dir, e), { recursive: true })
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  return dir
}

/** Nombre de tests en échec par fichier (suite qui ne charge pas = tous ses tests). */
function rejouer(dir) {
  const out = path.join(dir, 'resultat-vitest.json')
  try {
    execSync(`npx vitest run ${Object.values(TESTS).join(' ')} --reporter=json --outputFile=${JSON.stringify(out)}`, { cwd: dir, stdio: 'ignore' })
  } catch { /* des tests qui tombent = code de sortie ≠ 0 : attendu */ }
  const r = JSON.parse(fs.readFileSync(out, 'utf8'))
  const res = {}
  for (const [cle, f] of Object.entries(TESTS)) {
    const s = r.testResults.find((t) => t.name.split(path.sep).join('/').endsWith(f))
    const total = s ? s.assertionResults.length : 0
    const ko = s ? (s.status === 'failed' && total === 0 ? '∞' : s.assertionResults.filter((a) => a.status !== 'passed').length) : '?'
    res[cle] = { ko, total }
  }
  return res
}

const dir = copie()
const fichier = path.join(dir, CIBLE)
const orig = fs.readFileSync(fichier, 'utf8')
let anomalies = 0
try {
  const base = rejouer(dir)
  if (base.golden.ko !== 0 || base.couverture.ko !== 0) throw new Error('les tests ne passent pas sur le code NON muté : contrôle impossible')
  console.log(`Référence : golden ${base.golden.total} tests, couverture ${base.couverture.total} tests, tous verts.\n`)
  console.log('Mutation'.padEnd(36) + 'golden'.padEnd(10) + 'couverture'.padEnd(12) + 'verdict')
  for (const [nom, motif, remplacement, equivalente] of MUTATIONS) {
    const n = orig.split(motif).length - 1
    if (n !== 1) { console.log(`${nom.padEnd(36)}MOTIF TROUVÉ ${n} FOIS — le code a changé, mettre la liste à jour`); anomalies++; continue }
    fs.writeFileSync(fichier, orig.replace(motif, remplacement))
    const r = rejouer(dir)
    const tombe = r.golden.ko !== 0 || r.couverture.ko !== 0
    let verdict
    if (equivalente) { verdict = tombe ? 'ANOMALIE : déclarée équivalente mais tuée' : 'survit (équivalente)'; if (tombe) anomalies++ }
    else { verdict = tombe ? 'tuée' : 'SURVIT — trou de test'; if (!tombe) anomalies++ }
    console.log(nom.padEnd(36) + String(r.golden.ko).padEnd(10) + String(r.couverture.ko).padEnd(12) + verdict)
    if (equivalente) console.log(' '.repeat(4) + equivalente)
  }
} finally {
  fs.writeFileSync(fichier, orig)
  fs.rmSync(dir, { recursive: true, force: true })
}
console.log(anomalies ? `\n${anomalies} anomalie(s).` : '\nToutes les mutations non équivalentes sont tuées.')
process.exit(anomalies ? 1 : 0)
