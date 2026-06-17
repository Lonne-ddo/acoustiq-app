/**
 * useKeyboardShortcuts — hook réutilisable pour attacher un gestionnaire de
 * raccourcis clavier global (sur `window`).
 *
 * Principes :
 *   - Désactive automatiquement les raccourcis quand le focus est dans un
 *     champ de saisie (input/textarea/select/contenteditable) afin de ne pas
 *     voler les frappes de l'utilisateur.
 *   - Le gestionnaire renvoie `true` quand il a traité l'événement ; dans ce
 *     cas on appelle `preventDefault()` + `stopImmediatePropagation()` pour
 *     empêcher les autres gestionnaires (ex : pan du graphique dans App.tsx)
 *     de réagir à la même touche.
 *   - Attaché en phase de capture par défaut : le listener s'exécute AVANT
 *     les gestionnaires en phase de bulle attachés sur `document` ailleurs
 *     dans l'app, ce qui permet de « consommer » proprement une touche.
 */
import { useEffect, useRef } from 'react'

export interface ShortcutEvent {
  key: string
  code: string
  shift: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  /** Raccourci pour `e.ctrlKey || e.metaKey` (Ctrl sous Windows/Linux, ⌘ sous macOS) */
  mod: boolean
  native: KeyboardEvent
}

/** Renvoie `true` si l'événement a été traité (→ preventDefault + stop). */
export type ShortcutHandler = (e: ShortcutEvent) => boolean | void

function isEditableTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return false
}

export function useKeyboardShortcuts(
  handler: ShortcutHandler,
  options: { enabled?: boolean; capture?: boolean } = {},
): void {
  const { enabled = true, capture = true } = options
  // Référence mutable pour que le listener voie toujours le dernier handler
  // sans avoir à se ré-attacher à chaque rendu.
  const handlerRef = useRef(handler)
  useEffect(() => { handlerRef.current = handler })

  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return
      const handled = handlerRef.current({
        key: e.key,
        code: e.code,
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        alt: e.altKey,
        mod: e.ctrlKey || e.metaKey,
        native: e,
      })
      if (handled) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, capture)
    return () => window.removeEventListener('keydown', onKeyDown, capture)
  }, [enabled, capture])
}
