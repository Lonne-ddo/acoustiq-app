import { describe, it, expect } from 'vitest'
import { sniffDialect, splitLine, normalizeCell, type CsvDialect } from './csvDialect'

const FR: CsvDialect = { delimiter: ',', decimal: ',', quote: '"', dateFormat: 'iso' }
const EN: CsvDialect = { delimiter: ',', decimal: '.', quote: '"', dateFormat: 'iso' }

/**
 * Inverse du sériel Excel → ISO naïf (UTC), miroir de la formule de normalizeCell
 * et cohérent avec serialDaysToISO (qui lit le même sériel dans le pipeline).
 */
function serialToIsoUtc(serial: number): string {
  const ms = Math.round((serial * 86_400_000 + Date.UTC(1899, 11, 30)) / 1000) * 1000
  return new Date(ms).toISOString().slice(0, 19)
}

describe('normalizeCell — conforme au contrat SheetSource', () => {
  it("piège documenté : parseFloat('72,5') tronque à 72", () => {
    expect(parseFloat('72,5')).toBe(72) // NE PAS utiliser tel quel
  })

  it("'72,5' (dialecte virgule) → 72.5 (number)", () => {
    expect(normalizeCell('72,5', FR)).toBe(72.5)
    expect(normalizeCell('"72,5"', FR)).toBe(72.5) // guillemets résiduels tolérés
    expect(normalizeCell('-3,25', FR)).toBe(-3.25)
    expect(normalizeCell('140', FR)).toBe(140)
  })

  it("'72.5' (dialecte point) → 72.5 (number)", () => {
    expect(normalizeCell('72.5', EN)).toBe(72.5)
    // avec dialecte virgule, '72.5' n'est PAS un nombre → texte
    expect(normalizeCell('72.5', FR)).toBe('72.5')
  })

  it("vide → null (jamais undefined, jamais '')", () => {
    expect(normalizeCell('', FR)).toBeNull()
    expect(normalizeCell('   ', FR)).toBeNull()
    expect(normalizeCell('""', FR)).toBeNull()
    expect(normalizeCell('', FR)).not.toBeUndefined()
  })

  it('texte → string, guillemets retirés + en-tête trimé', () => {
    expect(normalizeCell("  Type d'enregistrement  ", FR)).toBe("Type d'enregistrement")
    expect(normalizeCell('Départ', FR)).toBe('Départ')
  })

  it("datetime double-espace → sériel Excel ; round-trip = '2025-07-03T11:13:42'", () => {
    const serial = normalizeCell('2025-07-03  11:13:42', FR)
    expect(typeof serial).toBe('number')
    expect(serialToIsoUtc(serial as number)).toBe('2025-07-03T11:13:42')
    // date seule (sans heure) → minuit
    const dOnly = normalizeCell('2025-07-03', FR)
    expect(serialToIsoUtc(dOnly as number)).toBe('2025-07-03T00:00:00')
  })
})

describe('décodage cp1252 (hypothèse d’encodage) + préservation par normalizeCell', () => {
  it("« Source d'énergie » et « Arrêtez » décodés puis normalisés en string", () => {
    // Octets windows-1252 : é = 0xE9, ê = 0xEA, ' = 0x27
    const src = new Uint8Array([0x53, 0x6F, 0x75, 0x72, 0x63, 0x65, 0x20, 0x64, 0x27, 0xE9, 0x6E, 0x65, 0x72, 0x67, 0x69, 0x65])
    const arr = new Uint8Array([0x41, 0x72, 0x72, 0xEA, 0x74, 0x65, 0x7A])
    const dec = new TextDecoder('windows-1252')
    expect(dec.decode(src)).toBe("Source d'énergie")
    expect(dec.decode(arr)).toBe('Arrêtez')
    // en-tête paddé d'espaces (comme le CSV G4) → trimé, accents préservés
    expect(normalizeCell('  ' + dec.decode(src) + '  ', FR)).toBe("Source d'énergie")
  })
})

describe('splitLine — respecte les guillemets (140 champs, pas 274)', () => {
  // Ligne G4-FR réaliste : 6 champs simples + 134 champs numériques quotés "72,5".
  const fields: string[] = ['1', 'Départ', '2025-07-03  11:13:42', 'BV-94', '', '831C']
  for (let i = 0; i < 134; i++) fields.push('"72,5"')
  const line = fields.join(',')

  it('découpage quote-aware → 140 champs', () => {
    expect(splitLine(line, FR)).toHaveLength(140)
  })

  it('découpage NAÏF (line.split) → 274 champs — le piège', () => {
    expect(line.split(',')).toHaveLength(274)
  })

  it('un champ quoté à virgule reste UN champ, quotes consommées', () => {
    const parts = splitLine('a,"72,5",b', FR)
    expect(parts).toEqual(['a', '72,5', 'b'])
  })

  it('guillemet échappé "" → guillemet littéral', () => {
    expect(splitLine('"a""b",c', FR)).toEqual(['a"b', 'c'])
  })
})

describe('sniffDialect — détecte, ne suppose pas', () => {
  // Fixture FR : en-tête 140 champs + ligne données 140 champs (numériques quotés).
  const hdr = Array.from({ length: 140 }, (_, i) => `H${i}`).join(',')
  const dataFields = ['1', 'Départ', '2025-07-03  11:13:42', 'BV-94', '', '831C']
  for (let i = 0; i < 134; i++) dataFields.push('"72,5"')
  const frLines = [hdr, dataFields.join(',')]

  it('G4-FR : délimiteur virgule, décimale virgule, largeur constante 140', () => {
    const d = sniffDialect(frLines)
    expect(d.delimiter).toBe(',')
    expect(d.decimal).toBe(',')
    expect(d.quote).toBe('"')
    // cohérence : la largeur détectée redonne 140
    expect(splitLine(frLines[1], d)).toHaveLength(140)
  })

  it('G4-EN simulé (point décimal, valeurs non quotées) → décimale point', () => {
    const enHdr = Array.from({ length: 8 }, (_, i) => `H${i}`).join(',')
    const enData = ['1', 'Run', '2025-07-03 11:13:42', '70.5', '71.2', '65.0', '80.1', '72.3'].join(',')
    const d = sniffDialect([enHdr, enData])
    expect(d.delimiter).toBe(',')
    expect(d.decimal).toBe('.')
  })

  it('délimiteur point-virgule correctement sniffé si largeur constante', () => {
    const d = sniffDialect(['A;B;C;D', '1;2;3;4', '5;6;7;8'])
    expect(d.delimiter).toBe(';')
  })
})
