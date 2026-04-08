/**
 * Checklist terrain — modal imprimable accessible depuis la sidebar.
 *
 * - 3 sections (avant / pendant / après mesure) avec items par défaut
 * - L'utilisateur peut cocher / décocher et ajouter ses propres items
 * - L'état est sauvegardé dans le projet (ProjectData.checklist)
 * - Bouton « Imprimer / PDF » pour produire un document propre
 */
import { useState } from 'react'
import { X, ClipboardCheck, Plus, Printer, Trash2 } from 'lucide-react'
import type { ChecklistState, ChecklistItem } from '../types'

const SECTIONS: Array<{ key: keyof ChecklistState; label: string }> = [
  { key: 'before', label: 'Avant la mesure' },
  { key: 'during', label: 'Pendant la mesure' },
  { key: 'after',  label: 'Après la mesure' },
]

export const DEFAULT_CHECKLIST: ChecklistState = {
  before: [
    { id: 'b1', text: 'Étalonnage avant (noter la valeur)', checked: false },
    { id: 'b2', text: 'Conditions météo vérifiées (vent < 20 km/h)', checked: false },
    { id: 'b3', text: 'Écran anti-vent installé', checked: false },
    { id: 'b4', text: 'Hauteur micro vérifiée (1.2 – 1.5 m)', checked: false },
    { id: 'b5', text: 'Distance obstacles > 3 m', checked: false },
    { id: 'b6', text: 'GPS coordonnées relevées', checked: false },
    { id: 'b7', text: 'Photos du montage prises', checked: false },
    { id: 'b8', text: 'Sources actives documentées', checked: false },
    { id: 'b9', text: 'Heure de début notée', checked: false },
  ],
  during: [
    { id: 'd1', text: 'Événements sonores particuliers notés', checked: false },
    { id: 'd2', text: 'Conditions météo stables', checked: false },
    { id: 'd3', text: 'Aucune précipitation', checked: false },
  ],
  after: [
    { id: 'a1', text: 'Étalonnage après (noter la valeur)', checked: false },
    { id: 'a2', text: 'Écart étalonnage < 0.5 dB (sinon données invalides)', checked: false },
    { id: 'a3', text: 'Fichiers sauvegardés', checked: false },
    { id: 'a4', text: 'Notes de terrain complètes', checked: false },
  ],
}

interface Props {
  open: boolean
  state: ChecklistState
  onChange: (next: ChecklistState) => void
  onClose: () => void
}

export default function ChecklistModal({ open, state, onChange, onClose }: Props) {
  const [newItemText, setNewItemText] = useState<Record<string, string>>({})

  if (!open) return null

  function toggle(section: keyof ChecklistState, id: string) {
    onChange({
      ...state,
      [section]: state[section].map((it) =>
        it.id === id ? { ...it, checked: !it.checked } : it,
      ),
    })
  }

  function addItem(section: keyof ChecklistState) {
    const text = (newItemText[section] ?? '').trim()
    if (!text) return
    const item: ChecklistItem = {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      checked: false,
      custom: true,
    }
    onChange({ ...state, [section]: [...state[section], item] })
    setNewItemText((prev) => ({ ...prev, [section]: '' }))
  }

  function removeItem(section: keyof ChecklistState, id: string) {
    onChange({
      ...state,
      [section]: state[section].filter((it) => it.id !== id),
    })
  }

  function handlePrint() {
    // Ouvre une fenêtre minimale ne contenant que la checklist (rendu d'impression propre)
    const w = window.open('', '_blank', 'width=900,height=1100')
    if (!w) return
    const today = new Date().toLocaleDateString('fr-CA')
    const sectionsHtml = SECTIONS.map((s) => {
      const items = state[s.key]
        .map(
          (it) =>
            `<li><span class="box">${it.checked ? '☑' : '☐'}</span> ${escapeHtml(it.text)}</li>`,
        )
        .join('')
      return `<h2>${s.label}</h2><ul>${items}</ul>`
    }).join('')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Checklist terrain — AcoustiQ</title>
      <style>
        body{font-family:system-ui,sans-serif;color:#111;max-width:800px;margin:24px auto;padding:0 24px}
        h1{font-size:20px;margin-bottom:4px}
        .meta{color:#666;font-size:12px;margin-bottom:24px}
        h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px}
        ul{list-style:none;padding:0;margin:0}
        li{padding:4px 0;font-size:13px;line-height:1.4}
        .box{display:inline-block;width:18px;font-size:14px}
        footer{margin-top:32px;padding-top:8px;border-top:1px solid #ccc;font-size:10px;color:#888;text-align:center}
      </style></head><body>
      <h1>Checklist terrain — Mesure acoustique</h1>
      <div class="meta">Date : ${today} · Référentiel : Lignes directrices MELCCFP 2026</div>
      ${sectionsHtml}
      <footer>Généré par AcoustiQ — https://acoustiq-app.pages.dev</footer>
      <script>window.onload=()=>{window.print();}</script>
    </body></html>`)
    w.document.close()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-2xl
                   max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={16} className="text-emerald-400" />
            <h2 className="text-sm font-semibold text-gray-100">Checklist terrain</h2>
            <span className="text-[10px] text-gray-500">MELCCFP 2026</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                         bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                         border border-gray-600 transition-colors"
              title="Imprimer / Exporter en PDF (via la fenêtre d'impression)"
            >
              <Printer size={11} />
              Imprimer / PDF
            </button>
            <button
              onClick={onClose}
              className="p-1 text-gray-500 hover:text-gray-200 rounded hover:bg-gray-800"
              aria-label="Fermer"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {SECTIONS.map((s) => (
            <section key={s.key}>
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {s.label}
              </h3>
              <ul className="space-y-1">
                {state[s.key].map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center gap-2 text-xs text-gray-200 group"
                  >
                    <input
                      type="checkbox"
                      checked={it.checked}
                      onChange={() => toggle(s.key, it.id)}
                      className="accent-emerald-500"
                    />
                    <span className={it.checked ? 'line-through text-gray-500' : ''}>
                      {it.text}
                    </span>
                    {it.custom && (
                      <button
                        onClick={() => removeItem(s.key, it.id)}
                        className="ml-auto opacity-0 group-hover:opacity-100 text-gray-600 hover:text-rose-400 transition-opacity"
                        title="Supprimer"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {/* Ajouter un item personnalisé */}
              <div className="flex items-center gap-1 mt-2">
                <input
                  type="text"
                  value={newItemText[s.key] ?? ''}
                  onChange={(e) =>
                    setNewItemText((prev) => ({ ...prev, [s.key]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addItem(s.key)
                  }}
                  placeholder="Ajouter un item…"
                  className="flex-1 text-xs bg-gray-800 text-gray-100 border border-gray-700
                             rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  onClick={() => addItem(s.key)}
                  className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-emerald-400
                             border border-gray-700"
                  title="Ajouter"
                >
                  <Plus size={12} />
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string))
}
