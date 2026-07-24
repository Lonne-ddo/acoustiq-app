import { describe, it, expect } from 'vitest'
import { parseCsv } from './csvParser'

const cp1252 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const blobOf = (s: string) => new Blob([cp1252(s)])

/**
 * Blob qui NE FONCTIONNE QUE par .stream(). Toute tentative de matérialisation
 * (.arrayBuffer / .text / .slice) JETTE. Si un jour quelqu'un « simplifie » le
 * chemin CSV en pré-chargeant le buffer, ces tests cassent au lieu de ramener
 * l'OOM en silence.
 */
function streamingOnlyBlob(bytes: Uint8Array): Blob {
  return {
    size: bytes.byteLength,
    stream: () => new Response(bytes).body as ReadableStream<Uint8Array>,
    arrayBuffer: () => { throw new Error('arrayBuffer() interdit — rematérialisation = retour de l’OOM') },
    text: () => { throw new Error('text() interdit — rematérialisation = retour de l’OOM') },
    slice: () => { throw new Error('slice() interdit — rematérialisation = retour de l’OOM') },
  } as unknown as Blob
}

const CSV = [
  "Type d'enregistrement,Date / heure,LAeq",
  ',2025-07-03 07:00:00,60',
  ',2025-07-03 07:00:01,61',
  ',2025-07-03 07:00:02,62',
].join('\r\n')

describe('GARDE-FOU OOM — parseCsv streame, ne matérialise JAMAIS', () => {
  it('réussit avec un Blob dont arrayBuffer()/text()/slice() jettent', async () => {
    const f = await parseCsv(streamingOnlyBlob(cp1252(CSV)), 'stream-only.csv')
    expect(f.data).toHaveLength(3)
    expect(f.data[0].laeq).toBe(60)
  })

  it('le Résumé aussi est streamé (pas matérialisé)', async () => {
    const resume = [
      'Mètre,SoundExpert 821,40489',
      'Heure de départ,2025-07-03 07:00:00',
      "Temps d'arrêt,2025-07-03 08:00:00",
    ].join('\r\n')
    const f = await parseCsv(streamingOnlyBlob(cp1252(CSV)), 'x.csv', streamingOnlyBlob(cp1252(resume)))
    expect(f.model).toBe('SoundExpert 821')
    expect(f.serial).toBe('40489')
  })

  it('parseCsv n’appelle pas non plus FileReader.readAsArrayBuffer', async () => {
    // parseCsv n'utilise pas FileReader (c'est le chemin xlsx de App). On le
    // verrouille : si présent, on le fait jeter — parseCsv doit réussir quand même.
    const FR = (globalThis as { FileReader?: { prototype: { readAsArrayBuffer: unknown } } }).FileReader
    const orig = FR?.prototype.readAsArrayBuffer
    if (FR) FR.prototype.readAsArrayBuffer = () => { throw new Error('readAsArrayBuffer interdit') }
    try {
      const f = await parseCsv(streamingOnlyBlob(cp1252(CSV)), 'x.csv')
      expect(f.data).toHaveLength(3)
    } finally {
      if (FR && orig) FR.prototype.readAsArrayBuffer = orig
    }
  })
})

describe('MESSAGE D’ERREUR — CSV rejeté reste informatif (liste les en-têtes)', () => {
  it('CSV non reconnu → FormatError « Format non reconnu » listant les en-têtes vus', async () => {
    const junk = ['Alpha,Beta,Gamma', '1,2,3', '4,5,6'].join('\r\n')
    await expect(parseCsv(blobOf(junk), 'junk.csv')).rejects.toThrow(/Format non reconnu/)
    await expect(parseCsv(blobOf(junk), 'junk.csv')).rejects.toThrow(/Alpha \| Beta \| Gamma/)
  })
})
