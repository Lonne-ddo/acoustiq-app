/**
 * Bloc d'upload pour un fichier Excel donné (Time History / Camionnage / Météo).
 * Drag & drop ou clic ; affiche le nom et un état de validation.
 */
import { useState } from 'react'
import { Upload, CheckCircle2, AlertCircle, X, Info } from 'lucide-react'

interface Props {
  label: string
  hint: string
  fileName: string | null
  error: string | null
  /** Texte multi-ligne décrivant la structure attendue (affiché en tooltip via icône info) */
  exampleHelp?: string
  onFile: (file: File) => void
  onClear: () => void
}

export default function FileUploadStep({
  label,
  hint,
  fileName,
  error,
  exampleHelp,
  onFile,
  onClear,
}: Props) {
  const [over, setOver] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  const hasFile = !!fileName
  const hasError = !!error

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true) }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false) }}
      onDrop={handleDrop}
      className={`relative flex flex-col items-center justify-center gap-1 px-4 py-4 rounded-lg
                  border-2 border-dashed cursor-pointer transition-colors text-center min-h-[120px] ${
                    hasError
                      ? 'border-rose-700 bg-rose-950/20'
                      : over
                      ? 'border-emerald-500 bg-emerald-950/20'
                      : hasFile
                      ? 'border-emerald-700/60 bg-emerald-950/10'
                      : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'
                  }`}
    >
      <input
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      {exampleHelp && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowHelp((v) => !v) }}
          onBlur={() => setTimeout(() => setShowHelp(false), 150)}
          className="absolute top-1 left-1 p-0.5 text-gray-500 hover:text-emerald-400"
          aria-label="Structure attendue"
          title="Voir la structure attendue"
        >
          <Info size={12} />
        </button>
      )}
      {showHelp && exampleHelp && (
        <div
          className="absolute top-6 left-1 right-1 z-10 px-2 py-1.5 rounded
                     bg-gray-900 border border-emerald-700/60 text-[10px] text-gray-200
                     text-left whitespace-pre-line shadow-lg pointer-events-none"
        >
          {exampleHelp}
        </div>
      )}
      {hasFile && !hasError ? (
        <>
          <CheckCircle2 size={20} className="text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">
            {label}
          </span>
          <span className="text-[11px] text-gray-300 truncate max-w-full" title={fileName ?? ''}>
            {fileName}
          </span>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear() }}
            className="absolute top-1 right-1 p-0.5 text-gray-500 hover:text-rose-400"
            aria-label="Retirer"
          >
            <X size={12} />
          </button>
        </>
      ) : hasError ? (
        <>
          <AlertCircle size={20} className="text-rose-400" />
          <span className="text-xs font-semibold text-rose-300 uppercase tracking-wider">
            {label}
          </span>
          <span className="text-[11px] text-rose-400 px-2">{error}</span>
        </>
      ) : (
        <>
          <Upload size={20} className="text-gray-500" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {label}
          </span>
          <span className="text-[10px] text-gray-600 px-2">{hint}</span>
        </>
      )}
    </label>
  )
}
