/**
 * Réexporte la surface COMPLÈTE du build CJS de `xlsx` (SSF compris), que le
 * lexer de named-exports de Node ne détecte pas à travers un `import * as`.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const X = require('xlsx')
export const read = X.read
export const readFile = X.readFile
export const write = X.write
export const writeFile = X.writeFile
export const utils = X.utils
export const SSF = X.SSF
export const set_fs = X.set_fs
export const version = X.version
export default X
