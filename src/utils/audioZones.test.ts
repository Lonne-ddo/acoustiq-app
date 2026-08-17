import { describe, it, expect } from 'vitest'
import { buildAudioZones } from './audioZones'
import type { AudioCoverageRange } from '../hooks/useAudioSync'

/** Plage de couverture audio, minutes depuis minuit sur l'axe X du chart. */
const R = (entryId: string, startMin: number, endMin: number): AudioCoverageRange => ({
  entryId,
  startMin,
  endMin,
  date: '2026-03-09',
})

/** Plage de mesure du graphique : 08:00 → 18:00. */
const FULL = { startMin: 480, endMin: 1080 }

describe('buildAudioZones', () => {
  // T1 — 0 fichier audio → aucune zone, donc aucune entrée de légende
  it('T1 : aucun fichier audio → aucune bande', () => {
    expect(buildAudioZones([], FULL)).toEqual([])
  })

  it('T1 bis : tous les fichiers hors de la plage de mesure → aucune bande', () => {
    const zones = buildAudioZones(
      [R('a', 0, 120), R('b', 1200, 1300)],
      FULL,
    )
    expect(zones).toEqual([])
  })

  // T2 — 1 fichier → 1 zone aux bonnes bornes
  it('T2 : un fichier → une bande aux bornes exactes', () => {
    const zones = buildAudioZones([R('a', 540, 600)], FULL)
    expect(zones).toHaveLength(1)
    expect(zones[0].x1).toBe(540)
    expect(zones[0].x2).toBe(600)
    expect(zones[0].entryIds).toEqual(['a'])
  })

  // T3 — 2 plages disjointes → 2 zones distinctes, pas de fusion
  it('T3 : deux plages disjointes → deux bandes, aucune fusion', () => {
    const zones = buildAudioZones([R('a', 540, 600), R('b', 660, 720)], FULL)
    expect(zones).toHaveLength(2)
    expect(zones[0]).toMatchObject({ x1: 540, x2: 600, entryIds: ['a'] })
    expect(zones[1]).toMatchObject({ x1: 660, x2: 720, entryIds: ['b'] })
  })

  it('T3 bis : un trou d\'une seconde reste un trou', () => {
    const zones = buildAudioZones([R('a', 540, 600), R('b', 600 + 1 / 60, 660)], FULL)
    expect(zones).toHaveLength(2)
  })

  it('T3 ter : l\'ordre d\'entrée n\'influe pas sur le résultat', () => {
    const zones = buildAudioZones([R('b', 660, 720), R('a', 540, 600)], FULL)
    expect(zones.map((z) => z.entryIds)).toEqual([['a'], ['b']])
  })

  // T3b — 2 plages qui se touchent → 1 zone fusionnée
  it('T3b : deux plages jointives → une seule bande fusionnée', () => {
    const zones = buildAudioZones([R('a', 540, 600), R('b', 600, 660)], FULL)
    expect(zones).toHaveLength(1)
    expect(zones[0].x1).toBe(540)
    expect(zones[0].x2).toBe(660)
    expect(zones[0].entryIds).toEqual(['a', 'b'])
  })

  it('T3b bis : deux plages qui se chevauchent → une seule bande', () => {
    const zones = buildAudioZones([R('a', 540, 620), R('b', 600, 660)], FULL)
    expect(zones).toHaveLength(1)
    expect(zones[0]).toMatchObject({ x1: 540, x2: 660, entryIds: ['a', 'b'] })
  })

  it('T3b ter : une plage entièrement incluse dans une autre ne raccourcit pas la bande', () => {
    const zones = buildAudioZones([R('a', 540, 700), R('b', 600, 620)], FULL)
    expect(zones).toHaveLength(1)
    expect(zones[0].x2).toBe(700)
  })

  it('T3b quater : trois plages, deux jointives et une isolée → deux bandes', () => {
    const zones = buildAudioZones(
      [R('a', 540, 600), R('b', 600, 660), R('c', 900, 960)],
      FULL,
    )
    expect(zones).toHaveLength(2)
    expect(zones[0]).toMatchObject({ x1: 540, x2: 660, entryIds: ['a', 'b'] })
    expect(zones[1]).toMatchObject({ x1: 900, x2: 960, entryIds: ['c'] })
  })

  // T4 — plage débordante → tronquée, axe inchangé
  it('T4 : une plage qui déborde des deux côtés est tronquée aux bornes du graphique', () => {
    const zones = buildAudioZones([R('a', 0, 1440)], FULL)
    expect(zones).toHaveLength(1)
    expect(zones[0].x1).toBe(FULL.startMin)
    expect(zones[0].x2).toBe(FULL.endMin)
  })

  it('T4 bis : débordement à gauche seulement', () => {
    const zones = buildAudioZones([R('a', 300, 540)], FULL)
    expect(zones[0]).toMatchObject({ x1: 480, x2: 540 })
  })

  it('T4 ter : débordement à droite seulement', () => {
    const zones = buildAudioZones([R('a', 1020, 1300)], FULL)
    expect(zones[0]).toMatchObject({ x1: 1020, x2: 1080 })
  })

  it('T4 quater : aucune borne produite ne sort de la plage du graphique', () => {
    const zones = buildAudioZones(
      [R('a', 0, 600), R('b', 700, 800), R('c', 1000, 2000)],
      FULL,
    )
    for (const z of zones) {
      expect(z.x1).toBeGreaterThanOrEqual(FULL.startMin)
      expect(z.x2).toBeLessThanOrEqual(FULL.endMin)
      expect(z.x2).toBeGreaterThan(z.x1)
    }
  })

  it('T4 quinquies : une plage tangente à une borne ne produit pas de bande de largeur nulle', () => {
    // Se termine exactement au début du graphique → rien à afficher.
    expect(buildAudioZones([R('a', 300, 480)], FULL)).toEqual([])
    // Commence exactement à la fin du graphique → rien à afficher.
    expect(buildAudioZones([R('b', 1080, 1200)], FULL)).toEqual([])
  })

  // Multi-jours : l'offset dayIndex × 1440 est déjà appliqué en amont, la
  // fonction ne fait que tronquer et fusionner sur l'axe absolu.
  it('multi-jours : bandes sur deux journées consécutives, non fusionnées', () => {
    const twoDays = { startMin: 0, endMin: 2880 }
    const zones = buildAudioZones(
      [R('j1', 1380, 1440), R('j2', 1500, 1560)],
      twoDays,
    )
    expect(zones).toHaveLength(2)
    expect(zones[0]).toMatchObject({ x1: 1380, x2: 1440 })
    expect(zones[1]).toMatchObject({ x1: 1500, x2: 1560 })
  })

  it('la clé React est stable et distingue les bandes', () => {
    const zones = buildAudioZones(
      [R('a', 540, 600), R('b', 600, 660), R('c', 900, 960)],
      FULL,
    )
    expect(zones.map((z) => z.key)).toEqual(['a+b', 'c'])
    expect(new Set(zones.map((z) => z.key)).size).toBe(zones.length)
  })

  it('l\'entrée n\'est pas mutée', () => {
    const input = [R('b', 660, 720), R('a', 540, 600)]
    const snapshot = JSON.parse(JSON.stringify(input))
    buildAudioZones(input, FULL)
    expect(input).toEqual(snapshot)
  })
})
