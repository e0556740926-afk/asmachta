export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo'
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-medium ${
                state === 'done'
                  ? 'bg-brand text-surface'
                  : state === 'active'
                    ? 'border-2 border-brand text-brand'
                    : 'border border-line text-muted'
              }`}
            >
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className={`text-sm ${state === 'todo' ? 'text-muted' : 'text-ink'}`}>{label}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-line" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}
