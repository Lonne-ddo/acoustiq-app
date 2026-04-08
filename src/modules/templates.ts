/**
 * Gestion des templates de projet (configurations réutilisables).
 * Persistance localStorage. Limite à 10 templates utilisateur ; les
 * templates « builtin » sont toujours disponibles en plus.
 */
import type { ProjectTemplate } from '../types'

const STORAGE_KEY = 'acoustiq_templates'
export const MAX_USER_TEMPLATES = 10

/** Templates fournis par défaut (non supprimables). */
export const BUILTIN_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'builtin-industrial',
    name: 'Source fixe industrielle',
    builtin: true,
    pointNames: ['BV-94', 'BV-98', 'BV-105', 'BV-106', 'BV-37', 'BV-107'],
    receptor: 'IV',
    period: 'jour',
    yMin: 40,
    yMax: 100,
  },
  {
    id: 'builtin-residential',
    name: 'Résidentiel standard',
    builtin: true,
    pointNames: ['BV-94', 'BV-98', 'BV-105', 'BV-106', 'BV-37', 'BV-107'],
    receptor: 'I',
    period: 'jour',
    yMin: 25,
    yMax: 80,
  },
]

export function loadUserTemplates(): ProjectTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ProjectTemplate[]
    return Array.isArray(parsed) ? parsed.filter((t) => !t.builtin) : []
  } catch {
    return []
  }
}

export function saveUserTemplates(templates: ProjectTemplate[]): void {
  const trimmed = templates.filter((t) => !t.builtin).slice(0, MAX_USER_TEMPLATES)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
}

/** Liste complète : builtins en tête, puis templates utilisateur. */
export function listAllTemplates(): ProjectTemplate[] {
  return [...BUILTIN_TEMPLATES, ...loadUserTemplates()]
}
