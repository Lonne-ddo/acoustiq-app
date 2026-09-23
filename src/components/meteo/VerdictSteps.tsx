import type { StepCls, VerdictStep } from '../../utils/recevabilite'

const RESULT_CLASS: Record<StepCls, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-rose-400',
  indetermine: 'text-gray-300',
  skip: 'text-gray-500 italic',
}

/** Arbre de décision affiché pas à pas (équivalent de `buildStepHtml` du standalone). */
export default function VerdictSteps({ steps }: { steps: VerdictStep[] }) {
  return (
    <ol className="space-y-1">
      {steps.map((s) => (
        <li key={s.n} className="flex items-start gap-2 text-xs">
          <span className="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center">
            {s.n}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-gray-200">{s.label}</div>
            <div className="text-[11px] text-gray-500">{s.detail}</div>
          </div>
          <span className={`shrink-0 text-[11px] font-semibold ${RESULT_CLASS[s.cls]}`}>{s.result}</span>
        </li>
      ))}
    </ol>
  )
}
