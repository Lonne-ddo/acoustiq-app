#!/usr/bin/env node
/**
 * Golden LOCAL des parseurs sur les relevés réels de .local-data/ (non versionnés).
 *
 *     node scripts/golden-parseurs-24h/reel.mjs fige      # écrit .local-data/golden-parseurs-24h.local.json
 *     node scripts/golden-parseurs-24h/reel.mjs compare   # compare, sortie 1 si écart
 *
 * Seuls les CSV sont traités : les feuilles au pas de 1 s des xlsx de plus de
 * 24 h font de 493 Mo à 1,08 Go de XML décompressé, au-delà de ce que SheetJS
 * peut lire (#19, constat voisin). Le golden reste dans .local-data/ (gitignoré) :
 * il est dérivé de données de mesure.
 */
import { register } from 'node:module'

register('../kt-recon.loader.mjs', import.meta.url)

const { main } = await import('./reel.body.mjs')
await main(process.argv.slice(2))
