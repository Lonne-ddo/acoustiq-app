/**
 * Codes météo WMO (Open-Meteo `weather_code`) → libellé français.
 * ECCC fournit directement un texte (`weatherText`), prioritaire.
 */
import type { MeteoHourRow } from './recevabilite'

export const WMO_FR: Record<number, string> = {
  0: 'Ciel clair', 1: 'Principalement clair', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine légère', 53: 'Bruine modérée', 55: 'Bruine dense',
  56: 'Bruine verglaçante légère', 57: 'Bruine verglaçante dense',
  61: 'Pluie légère', 63: 'Pluie modérée', 65: 'Pluie forte',
  66: 'Pluie verglaçante légère', 67: 'Pluie verglaçante forte',
  71: 'Neige légère', 73: 'Neige modérée', 75: 'Neige forte', 77: 'Granules de neige',
  80: 'Averses légères', 81: 'Averses modérées', 82: 'Averses violentes',
  85: 'Averses de neige légères', 86: 'Averses de neige fortes',
  95: 'Orage', 96: 'Orage avec grêle légère', 99: 'Orage avec grêle forte',
}

/** Conditions lisibles : texte ECCC, sinon libellé WMO, sinon « code N », sinon « — ». */
export function conditionsLabel(r: Pick<MeteoHourRow, 'weatherText' | 'weatherCode'>): string {
  if (r.weatherText && r.weatherText !== 'NA') return r.weatherText
  if (r.weatherCode != null) return WMO_FR[r.weatherCode] ?? `code ${r.weatherCode}`
  return '—'
}
