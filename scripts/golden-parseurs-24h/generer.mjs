#!/usr/bin/env node
/**
 * Générateur du golden des parseurs > 24 h (#19) — voir README.md.
 *
 *     node scripts/golden-parseurs-24h/generer.mjs            # vérifie, n'écrit rien
 *     node scripts/golden-parseurs-24h/generer.mjs --ecrire   # ajoute les cas nouveaux
 *
 * Amorce : le hook de résolution n'agit que sur les imports qui le SUIVENT.
 */
import { register } from 'node:module'

register('../kt-recon.loader.mjs', import.meta.url)

const { main } = await import('./generer.body.mjs')
await main(process.argv.slice(2))
