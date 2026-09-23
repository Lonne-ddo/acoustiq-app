// GOLDEN des parseurs SheetJS d'AcoustiQ (chemin de LECTURE).
// Mode d'emploi, provenance et limites : docs/sheetjs.md.
//
//   node scripts/sheetjs-golden/golden.mjs fige    <golden.json> [filtre]
//   node scripts/sheetjs-golden/golden.mjs compare <golden.json> [filtre]
//
// `filtre` : sous-chaîne du nom de fichier (ex. « 250311 », « 831C »).
// `xlsx` = celui du dépôt, sauf XLSX_IMPL=<dossier d'un paquet xlsx extrait>.
//
// Chaque parseur de lecture est exécuté sur chaque fichier de .local-data/.
// Sortie comparée : sérialisation canonique COMPLÈTE (NaN, ±Infinity, -0,
// undefined, Date distingués ; ordre des clés conservé) → SHA-256. Une erreur
// levée est un résultat comme un autre : son message exact est figé.
// Les dumps de diagnostic vont dans le dossier temporaire du système, jamais
// dans le dépôt (ils contiennent des données de mesure).
import { register } from 'node:module'
register('./loader.mjs', import.meta.url)

const fs = await import('node:fs')
const os = await import('node:os')
const path = await import('node:path')
const crypto = await import('node:crypto')
const { fileURLToPath, pathToFileURL } = await import('node:url')

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DATA = path.join(REPO, '.local-data')
const src = (rel) => import(pathToFileURL(path.join(REPO, rel)).href)

const X = (await import('xlsx')).default
const { parseWorkbook } = await src('src/modules/formatDetectors.ts')
const { parseEcmeFile } = await src('src/utils/ecmeParser.ts')
const { parseLpFile } = await src('src/utils/universalParser.ts')
const carriere = await src('src/utils/carriereParser.ts')

// crypto.randomUUID (id de MeasurementFile, formatDetectors.ts) rendu
// DÉTERMINISTE : compteur remis à zéro avant chaque analyse. Sans cela, deux
// exécutions de la MÊME version diffèrent — ce ne serait pas un écart SheetJS.
let uuidN = 0
globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, '0')}`

const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const PARSEURS = {
  parseWorkbook: (buf, name) => parseWorkbook(ab(buf), name),
  parseEcmeFile: (buf, name) => parseEcmeFile(new File([buf], name)),
  parseLpFile: (buf, name) => parseLpFile(new File([buf], name)),
  parseTimeHistorySheet: (buf) => carriere.parseTimeHistorySheet(ab(buf)),
  parseCamionnageSheet: (buf) => carriere.parseCamionnageSheet(ab(buf), 10),
  parseMeteoSheet: (buf) => carriere.parseMeteoSheet(ab(buf)),
}

/** Sérialisation canonique : aucune valeur n'est confondue avec une autre. */
function canon(v, seen = new WeakSet()) {
  if (v === undefined) return '{"$u":1}'
  if (v === null) return 'null'
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return '{"$n":"NaN"}'
    if (v === Infinity) return '{"$n":"+Inf"}'
    if (v === -Infinity) return '{"$n":"-Inf"}'
    if (Object.is(v, -0)) return '{"$n":"-0"}'
    return String(v)
  }
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v)
  if (typeof v === 'bigint') return `{"$b":"${v}"}`
  if (typeof v === 'function') return '{"$f":1}'
  if (v instanceof Date) return `{"$d":${JSON.stringify(Number.isNaN(v.getTime()) ? 'Invalid' : v.toISOString())}}`
  if (seen.has(v)) return '{"$cycle":1}'
  seen.add(v)
  let out
  if (Array.isArray(v) || ArrayBuffer.isView(v)) out = '[' + Array.from(v, (x) => canon(x, seen)).join(',') + ']'
  else if (v instanceof Map) out = '{"$map":[' + [...v].map(([k, x]) => '[' + canon(k, seen) + ',' + canon(x, seen) + ']').join(',') + ']}'
  else if (v instanceof Set) out = '{"$set":[' + [...v].map((x) => canon(x, seen)).join(',') + ']}'
  else out = '{' + Object.keys(v).map((k) => JSON.stringify(k) + ':' + canon(v[k], seen)).join(',') + '}'
  seen.delete(v)
  return out
}

function resume(r) {
  if (r == null || typeof r !== 'object') return { type: typeof r }
  if (Array.isArray(r)) return { array: r.length }
  const o = {}
  for (const [k, x] of Object.entries(r)) {
    if (Array.isArray(x)) o[k] = `[${x.length}]`
    else if (x == null || typeof x !== 'object') o[k] = x
  }
  return o
}

const [mode, fichierGolden, filtre] = process.argv.slice(2)
if (!['fige', 'compare'].includes(mode) || !fichierGolden) {
  console.error('usage : golden.mjs fige|compare <golden.json> [filtre]')
  process.exit(2)
}
const files = fs.readdirSync(DATA).filter((n) => /\.(xlsx|xls|csv)$/i.test(n)).filter((n) => !filtre || n.includes(filtre)).sort()
const dumpDir = path.join(os.tmpdir(), 'acoustiq-sheetjs-golden', `${path.basename(fichierGolden, '.json')}.dumps-${X.version}`)
fs.mkdirSync(dumpDir, { recursive: true })

const res = {}
console.log(`xlsx ${X.version} · ${files.length} fichier(s) · mode ${mode} · dumps ${dumpDir}`)
for (const name of files) {
  const buf = fs.readFileSync(path.join(DATA, name))
  res[name] = {}
  for (const [pn, fn] of Object.entries(PARSEURS)) {
    const t = Date.now()
    uuidN = 0
    let entry
    try {
      const out = await fn(buf, name)
      const c = canon(out)
      entry = { statut: 'ok', sha256: crypto.createHash('sha256').update(c).digest('hex'), taille: c.length, resume: resume(out) }
      if (c.length < 5e6) fs.writeFileSync(path.join(dumpDir, `${name}__${pn}.json`), c)
    } catch (e) {
      entry = { statut: 'erreur', message: String(e && e.message ? e.message : e) }
    }
    entry.secondes = +((Date.now() - t) / 1000).toFixed(1)
    res[name][pn] = entry
    console.log(`  ${name.padEnd(56)} ${pn.padEnd(22)} ${entry.statut.padEnd(6)} ${entry.secondes}s ${entry.statut === 'ok' ? entry.sha256.slice(0, 12) : entry.message.slice(0, 60)}`)
  }
}

if (mode === 'fige') {
  const prev = fs.existsSync(fichierGolden) ? JSON.parse(fs.readFileSync(fichierGolden, 'utf8')) : { fichiers: {} }
  const golden = { ...prev, xlsx: X.version, figeLe: new Date().toISOString(), fichiers: { ...prev.fichiers, ...res } }
  fs.writeFileSync(fichierGolden, JSON.stringify(golden, null, 2) + '\n')
  console.log(`GOLDEN FIGÉ → ${fichierGolden}`)
} else {
  const g = JSON.parse(fs.readFileSync(fichierGolden, 'utf8'))
  let ecarts = 0
  let acceptes = 0
  let n = 0
  for (const [name, parts] of Object.entries(res)) {
    for (const [pn, e] of Object.entries(parts)) {
      const ref = g.fichiers[name]?.[pn]
      n++
      if (!ref) { ecarts++; console.log(`  ✗ ABSENT DU GOLDEN : ${name} · ${pn}`); continue }
      const same = ref.statut === e.statut && (e.statut === 'ok' ? ref.sha256 === e.sha256 : ref.message === e.message)
      // Écart ACCEPTÉ : seulement si la sortie correspond EXACTEMENT à l'empreinte validée.
      const acc = (g.ecartsAcceptes || []).find((x) => x.fichier === name && x.parseur === pn)
      if (!same && acc && e.sha256?.startsWith(acc.sha256_0_20_3)) {
        acceptes++
        console.log(`  ≈ ÉCART ACCEPTÉ ${name} · ${pn} — ${acc.explication}`)
        continue
      }
      if (!same) {
        ecarts++
        console.log(`  ✗ ÉCART ${name} · ${pn}`)
        console.log(`      golden (${g.xlsx}) : ${ref.statut} ${ref.statut === 'ok' ? ref.sha256.slice(0, 16) + ' ' + JSON.stringify(ref.resume) : ref.message}`)
        console.log(`      actuel (${X.version}) : ${e.statut} ${e.statut === 'ok' ? e.sha256.slice(0, 16) + ' ' + JSON.stringify(e.resume) : e.message}`)
      }
    }
  }
  console.log(ecarts === 0
    ? `ÉGALITÉ STRICTE : ${n - acceptes}/${n} (fichier × parseur)${acceptes ? ` + ${acceptes} écart(s) ACCEPTÉ(S) documenté(s)` : ''}, golden ${g.xlsx} → ${X.version}`
    : `${ecarts} ÉCART(S) NON ACCEPTÉ(S) sur ${n}`)
  process.exitCode = ecarts === 0 ? 0 : 1
}
