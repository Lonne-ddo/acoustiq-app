import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseCsv, pairResume } from '../../src/modules/csvParser.ts'
import { resumer, empreinte } from '../../src/modules/parseurs24h.golden.ts'
import { canon } from '../../src/utils/serialisationCanonique.ts'

const ROOT_DIR = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'))
const DATA = path.join(ROOT_DIR, '.local-data')
const SORTIE = path.join(DATA, 'golden-parseurs-24h.local.json')

export async function main([mode]) {
  if (mode !== 'fige' && mode !== 'compare') { console.error('usage : reel.mjs fige|compare'); process.exit(2) }
  const csv = fs.readdirSync(DATA).filter((n) => /\.csv$/i.test(n))
  const res = {}
  for (const nom of csv) {
    const r = pairResume(nom, csv)
    const f = await parseCsv(new Blob([fs.readFileSync(path.join(DATA, nom))]), nom, r ? new Blob([fs.readFileSync(path.join(DATA, r))]) : undefined)
    const { t: _t, ...resume } = { t: 0, ...resumer(f) }
    res[nom] = { sha256: empreinte(f), resume: { ...resume, sauts: resume.sauts.length } }
    console.log(`${nom} : ${JSON.stringify(res[nom].resume)}`)
  }
  if (mode === 'fige') {
    fs.writeFileSync(SORTIE, JSON.stringify({ figeLe: new Date().toISOString(), cas: res }, null, 2) + '\n')
    console.log(`\nFigé : ${path.relative(ROOT_DIR, SORTIE)}`)
    return
  }
  const g = JSON.parse(fs.readFileSync(SORTIE, 'utf8')).cas
  let ecarts = 0
  for (const [nom, e] of Object.entries(res)) {
    const ok = g[nom] && g[nom].sha256 === e.sha256 && canon(g[nom].resume) === canon(e.resume)
    console.log(`${ok ? '=' : '≠'} ${nom}`)
    if (!ok) ecarts++
  }
  process.exit(ecarts ? 1 : 0)
}
