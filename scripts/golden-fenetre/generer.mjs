#!/usr/bin/env node
/**
 * Générateur du golden de la fenêtre LAr,1h — voir README.md.
 *
 *     node scripts/golden-fenetre/generer.mjs            # vérifie (aucune écriture)
 *     node scripts/golden-fenetre/generer.mjs --ecrire   # ajoute les cas nouveaux
 *
 * Amorce : le hook de résolution n'agit que sur les imports qui le SUIVENT.
 */
import { register } from 'node:module'

register('../kt-recon.loader.mjs', import.meta.url)

const { main } = await import('./generer.body.mjs')
await main(process.argv.slice(2))
