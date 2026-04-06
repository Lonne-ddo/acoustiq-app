/**
 * Gestion des paramètres persistés en localStorage
 */
import type { AppSettings } from '../types'

const STORAGE_KEY = 'acoustiq_settings'

export const DEFAULT_SETTINGS: AppSettings = {
  pointColors: {
    'BV-94':  '#10b981',
    'BV-98':  '#3b82f6',
    'BV-105': '#f59e0b',
    'BV-106': '#ef4444',
    'BV-37':  '#8b5cf6',
    'BV-107': '#06b6d4',
  },
  yAxisMin: 30,
  yAxisMax: 90,
  aggregationInterval: 5,
  companyName: '',
  language: 'fr',
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
