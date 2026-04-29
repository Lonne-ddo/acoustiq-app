/**
 * Géocodage : Photon (Komoot) en priorité, fallback Open-Meteo.
 * Aucune clé API. Accepte aussi des coordonnées brutes « lat, lng ».
 */

export interface GeocodeResult {
  lat: number
  lng: number
  displayName: string
}

const COORDS_RE = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/

function parseRawCoords(query: string): GeocodeResult | null {
  const m = query.match(COORDS_RE)
  if (!m) return null
  const lat = parseFloat(m[1])
  const lng = parseFloat(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return {
    lat,
    lng,
    displayName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  }
}

async function geocodePhoton(query: string): Promise<GeocodeResult | null> {
  // Biaisé vers le Québec (Québec/Lévis ~ 46.8 N, 71.2 W).
  const url =
    `https://photon.komoot.io/api?q=${encodeURIComponent(query)}` +
    `&lang=fr&limit=1&lat=46.8&lon=-71.2`
  const r = await fetch(url)
  if (!r.ok) return null
  const j = await r.json()
  if (!j?.features?.length) return null
  const f = j.features[0]
  const [lng, lat] = f.geometry.coordinates as [number, number]
  const p = f.properties || {}
  const parts = [
    p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street || p.name,
    p.district || p.suburb,
    p.city || p.town || p.village,
    p.state,
    p.country,
  ].filter(Boolean)
  return {
    lat,
    lng,
    displayName: parts.join(', ') || p.name || query,
  }
}

async function geocodeOpenMeteo(query: string): Promise<GeocodeResult | null> {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
    `&count=1&language=fr&format=json`
  const r = await fetch(url)
  if (!r.ok) return null
  const j = await r.json()
  if (!j?.results?.length) return null
  const r0 = j.results[0]
  return {
    lat: r0.latitude,
    lng: r0.longitude,
    displayName: [r0.name, r0.admin1, r0.country].filter(Boolean).join(', '),
  }
}

export async function geocode(query: string): Promise<GeocodeResult> {
  const trimmed = query.trim()
  if (!trimmed) throw new Error('Adresse vide')

  const raw = parseRawCoords(trimmed)
  if (raw) return raw

  try {
    const photon = await geocodePhoton(trimmed)
    if (photon) return photon
  } catch {
    /* fallback */
  }

  const om = await geocodeOpenMeteo(trimmed)
  if (om) return om

  throw new Error(`Localisation introuvable : « ${trimmed} »`)
}
