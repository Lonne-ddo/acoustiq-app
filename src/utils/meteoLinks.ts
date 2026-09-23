/**
 * Liens de consultation MANUELLE, construits à partir des coordonnées du point
 * (aucune requête : de simples URL pré-remplies, ouvertes dans un nouvel onglet).
 *   - externalLinks : sites grand public pour un recoupement à l'œil ;
 *   - viewerUrl     : page de consultation de la source effectivement utilisée,
 *                     pour vérifier une valeur à la source.
 */
import type { SourceResult } from './meteoSources'

export interface ExternalLink {
  name: string
  desc: string
  url: string
}

export function externalLinks(lat: number, lng: number): ExternalLink[] {
  return [
    {
      name: 'Météo Canada (MSC)',
      desc: 'Prévisions officielles · positionné sur les coordonnées',
      url: `https://meteo.gc.ca/fr/location/index.html?coords=${lat.toFixed(3)},${lng.toFixed(3)}`,
    },
    {
      name: 'Weather Underground · carte',
      desc: 'Wundermap · stations privées · radar',
      url: `https://www.wunderground.com/wundermap?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&zoom=10`,
    },
    {
      name: 'Windfinder',
      desc: 'Spécialisé vent · sites côtiers, lacustres ou éoliens',
      url: `https://www.windfinder.com/#9/${lat.toFixed(4)}/${lng.toFixed(4)}`,
    },
  ]
}

const OM_HOURLY =
  'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,weather_code'

/**
 * Page de consultation de la source d'un résultat. ECCC : page « données
 * horaires » de la station retenue (StationID retrouvé parmi les candidats par
 * son identifiant climatologique) ; à défaut, l'accueil des données climatiques.
 */
export function viewerUrl(
  s: SourceResult,
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): string {
  const loc = `latitude=${lat}&longitude=${lng}`
  if (s.source === 'gem') {
    return `https://open-meteo.com/en/docs/gem-api?${loc}&hourly=${OM_HOURLY}&past_days=7&timezone=America%2FToronto`
  }
  if (s.source === 'openmeteo') {
    return s.isArchive
      ? `https://open-meteo.com/en/docs/historical-weather-api?${loc}&start_date=${startDate}&end_date=${endDate}&hourly=${OM_HOURLY}&timezone=America%2FToronto`
      : `https://open-meteo.com/en/docs?${loc}&hourly=${OM_HOURLY}&past_days=7&timezone=America%2FToronto`
  }
  const stnId = s.candidates?.find((c) => c.climateId === s.station.climateId)?.stnId
  const m = startDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (stnId == null || !m) return 'https://climate.weather.gc.ca/'
  return (
    `https://climate.weather.gc.ca/climate_data/hourly_data_e.html?StationID=${stnId}` +
    `&Year=${Number(m[1])}&Month=${Number(m[2])}&Day=${Number(m[3])}&timeframe=1`
  )
}
