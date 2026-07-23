import { describe, it, expect } from 'vitest'
import { streamLines, streamBlobLines } from './csvLineStream'

// Encode une chaîne en octets cp1252 : nos accents (é/à/ù/ê ∈ 0xE0-0xFF) ont le
// même code que leur point Unicode → charCodeAt donne l'octet cp1252 directement.
const cp1252 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

async function* chunked(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size)
}

async function collect(gen: AsyncGenerator<string, void, unknown>): Promise<string[]> {
  const out: string[] = []
  for await (const l of gen) out.push(l)
  return out
}

describe('streamLines — reconstitution indépendante de la découpe en chunks', () => {
  // \r\n, \n mêlés ; accents ; ligne à champ quoté contenant une virgule ; pas de \n final.
  const content = 'Type,LAeq,Note\r\n1,"72,5",Arrêtez\n2,"68,3",Départ\r\néàù,fin,'
  const bytes = cp1252(content)
  const expected = ['Type,LAeq,Note', '1,"72,5",Arrêtez', '2,"68,3",Départ', 'éàù,fin,']

  it('sanity : cp1252 round-trip (accents préservés)', () => {
    expect(new TextDecoder('windows-1252').decode(bytes)).toBe(content)
  })

  it.each([1, 3, 7, 64, 65536])('lignes exactes à chunk = %i octets', async (size) => {
    expect(await collect(streamLines(chunked(bytes, size)))).toEqual(expected)
  })

  it('un \\r\\n coupé entre les deux octets (chunk=1) reste géré', async () => {
    // chunk=1 garantit \r et \n dans des chunks séparés à chaque saut de ligne.
    const lines = await collect(streamLines(chunked(bytes, 1)))
    expect(lines).toEqual(expected)
    expect(lines[1]).toBe('1,"72,5",Arrêtez') // virgule quotée intacte (pas de split ici)
  })

  it('newline final → pas de ligne vide fantôme ; ligne vide interne préservée', async () => {
    expect(await collect(streamLines(chunked(cp1252('a\nb\n'), 4)))).toEqual(['a', 'b'])
    expect(await collect(streamLines(chunked(cp1252('a\n\nb'), 4)))).toEqual(['a', '', 'b'])
  })

  it('flux vide → aucune ligne', async () => {
    expect(await collect(streamLines(chunked(new Uint8Array(0), 8)))).toEqual([])
  })
})

describe('streamBlobLines — chemin Blob réel', () => {
  it('lit un Blob cp1252 en lignes', async () => {
    const content = 'a,"1,5"\r\nb,Arrêtez\néàù'
    const blob = new Blob([cp1252(content)])
    expect(await collect(streamBlobLines(blob))).toEqual(['a,"1,5"', 'b,Arrêtez', 'éàù'])
  })
})
