/* Génère src/data/yamnetCategories.ts depuis le standalone de référence. */
const fs = require('fs')
const path = require('path')

const SRC = 'C:/Users/estel/Downloads/yamnet_classifier_standalone.html'
const OUT = path.join(__dirname, '..', 'src', 'data', 'yamnetCategories.ts')

const html = fs.readFileSync(SRC, 'utf8')
const m = html.match(/<script id="mapping-data"[^>]*>([\s\S]*?)<\/script>/)
if (!m) throw new Error('mapping-data introuvable')
const json = JSON.parse(m[1].trim())
const cats = json.categories
const c2c = json.class_to_cat
const names = json.class_names

const dist = c2c.reduce((a, c) => { a[c] = (a[c] || 0) + 1; return a }, {})

let c2cStr = ''
for (let i = 0; i < c2c.length; i += 20) {
  c2cStr += '  ' + c2c.slice(i, i + 20).join(', ') + ',\n'
}

const namesStr = names.map((n) => '  ' + JSON.stringify(n) + ',').join('\n')

const catEntries = Object.entries(cats)
  .map(([id, c]) =>
    `  "${id}": { id: "${id}", name: ${JSON.stringify(c.name)}, short: ${JSON.stringify(c.short)}, color: ${JSON.stringify(c.color)} },`,
  )
  .join('\n')

const header = [
  '/**',
  ' * Mapping des 521 classes AudioSet/YAMNet vers 7 categories acoustiques.',
  ' *',
  ' * GENERE — extrait verbatim du standalone yamnet_classifier_standalone.html',
  ' * (bloc <script id="mapping-data">), via scripts/gen-yamnet-map.cjs.',
  ' * Ne pas editer a la main : regenerer depuis le standalone de reference.',
  ' *',
  ' *   - CATEGORIES      : 7 categories (id "1".."7") + libelles + couleurs.',
  ' *   - CLASS_TO_CAT[k] : id de categorie (1..7) de la classe YAMNet d index k.',
  ' *   - CLASS_NAMES[k]  : libelle AudioSet de la classe d index k.',
  ' *',
  ' * Distribution par categorie : ' + JSON.stringify(dist),
  ' */',
].join('\n')

const out = `${header}

export type CategoryId = "1" | "2" | "3" | "4" | "5" | "6" | "7"

export interface Category {
  id: CategoryId
  name: string
  short: string
  color: string
}

export const CATEGORIES: Record<CategoryId, Category> = {
${catEntries}
}

/** Ordre d'affichage des categories. */
export const CATEGORY_IDS: CategoryId[] = ["1", "2", "3", "4", "5", "6", "7"]

/** Categorie Indetermine — defaut/fallback de mapping ET libelle sous seuil. */
export const INDETERMINE_ID: CategoryId = "7"

/** id de categorie (1..7) pour chacune des 521 classes YAMNet, ordre canonique. */
export const CLASS_TO_CAT: number[] = [
${c2cStr}]

/** Libelles AudioSet des 521 classes YAMNet, ordre canonique. */
export const CLASS_NAMES: string[] = [
${namesStr}
]
`

fs.writeFileSync(OUT, out)
console.log('written', OUT, out.length, 'chars; CLASS_TO_CAT=' + c2c.length, 'CLASS_NAMES=' + names.length)
