/**
 * Lecture EN FLUX d'un CSV G4 en lignes, sans jamais matérialiser le fichier.
 *
 * Chaîne : Blob.stream() → TextDecoder('windows-1252', {stream:true}) →
 * découpage en lignes tolérant les frontières de chunk (buffer résiduel).
 *
 * Le cœur `streamLines` consomme un `AsyncIterable<Uint8Array>` (découplé de Blob)
 * pour être testable à taille de chunk arbitraire ; `streamBlobLines` l'alimente
 * depuis un vrai Blob.
 *
 * HYPOTHÈSES / LIMITES (documentées) :
 * - Découpage sur les newlines PHYSIQUES (\n), \r\n et \n gérés. Un newline
 *   À L'INTÉRIEUR d'un champ quoté n'est PAS géré ici (couperait la ligne) —
 *   non observé dans les exports G4 ; le gérer exigerait de suivre l'état des
 *   guillemets au niveau octet, couplage qu'on refuse à ce niveau. Si un tel
 *   fichier apparaissait, c'est ICI qu'il faudrait l'adresser.
 * - cp1252 est mono-octet : un caractère ne peut pas être coupé entre deux chunks.
 *   On garde tout de même {stream:true} par principe (robustesse si l'encodage
 *   évoluait) + un flush final.
 */

/**
 * Découpe un flux d'octets en lignes. Chaque ligne est rendue SANS le séparateur
 * (\n ou \r\n). La dernière ligne sans newline final est rendue à la fin. Une
 * fin de fichier terminée par un newline ne produit PAS de ligne vide fantôme.
 */
export async function* streamLines(source: AsyncIterable<Uint8Array>): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder('windows-1252', { fatal: false })
  let buf = ''

  for await (const chunk of source) {
    // {stream:true} : conserve un éventuel octet en attente entre deux chunks.
    buf += decoder.decode(chunk, { stream: true })

    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      let line = buf.slice(0, nl)
      if (line.endsWith('\r')) line = line.slice(0, -1) // \r\n → \n
      yield line
      buf = buf.slice(nl + 1) // le reste (fin partielle éventuelle) reste en buffer
    }
    // buf contient ici une fin de ligne PARTIELLE : jamais parsée tant que le \n
    // n'est pas arrivé.
  }

  // Fin de flux : vide le décodeur (no-op en mono-octet) + rend la dernière ligne.
  buf += decoder.decode()
  if (buf.length > 0) {
    if (buf.endsWith('\r')) buf = buf.slice(0, -1)
    yield buf
  }
}

/** Adapte un ReadableStream<Uint8Array> en AsyncIterable de chunks (via reader). */
async function* readableToChunks(rs: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array, void, unknown> {
  const reader = rs.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

/** Lit un Blob en flux et rend ses lignes (voir `streamLines`). */
export function streamBlobLines(blob: Blob): AsyncGenerator<string, void, unknown> {
  return streamLines(readableToChunks(blob.stream() as ReadableStream<Uint8Array>))
}
