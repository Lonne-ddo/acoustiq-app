// Module substitué à `xlsx` par loader.mjs. Par défaut : le xlsx du dépôt
// (node_modules/xlsx). XLSX_IMPL=<dossier d'un paquet xlsx extrait> permet de
// rejouer le golden sur une AUTRE version sans toucher au dépôt.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const impl =
  process.env.XLSX_IMPL ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'xlsx')
const require = createRequire(path.join(impl, 'package.json'))
const X = require(impl)
export const { read, readFile, write, writeFile, utils, SSF, set_fs, version } = X
export default X
