/**
 * Sérialisation CANONIQUE pour les golden de non-régression : aucune valeur
 * n'est confondue avec une autre (NaN, ±Infinity, -0, undefined, dates,
 * Map/Set distingués ; ordre des clés conservé). Égalité de deux sorties ⇔
 * égalité de leurs sérialisations.
 */
export function canon(v: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (v === undefined) return '{"$u":1}'
  if (v === null) return 'null'
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return '{"$n":"NaN"}'
    if (v === Infinity) return '{"$n":"+Inf"}'
    if (v === -Infinity) return '{"$n":"-Inf"}'
    if (Object.is(v, -0)) return '{"$n":"-0"}'
    return String(v)
  }
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v)
  if (typeof v === 'bigint') return `{"$b":"${v}"}`
  if (typeof v === 'function') return '{"$f":1}'
  if (v instanceof Date) return `{"$d":${JSON.stringify(Number.isNaN(v.getTime()) ? 'Invalid' : v.toISOString())}}`
  const o = v as object
  if (seen.has(o)) return '{"$cycle":1}'
  seen.add(o)
  let out: string
  if (Array.isArray(o) || ArrayBuffer.isView(o)) out = '[' + Array.from(o as ArrayLike<unknown>, (x) => canon(x, seen)).join(',') + ']'
  else if (o instanceof Map) out = '{"$map":[' + [...o].map(([k, x]) => '[' + canon(k, seen) + ',' + canon(x, seen) + ']').join(',') + ']}'
  else if (o instanceof Set) out = '{"$set":[' + [...o].map((x) => canon(x, seen)).join(',') + ']}'
  else out = '{' + Object.keys(o).map((k) => JSON.stringify(k) + ':' + canon((o as Record<string, unknown>)[k], seen)).join(',') + '}'
  seen.delete(o)
  return out
}
