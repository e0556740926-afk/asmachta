import type { ReactNode } from 'react'
import { Num } from './Primitives'

/** A small reference pill for a case-law or legislation citation embedded in Hebrew text. */
export function CitationChip({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex cursor-pointer items-center rounded-md border border-line bg-tint px-2 py-0.5 text-xs text-brand hover:border-brand"
      >
        <Num>{children}</Num>
      </button>
    )
  }
  return (
    <span className="inline-flex items-center rounded-md border border-line bg-tint px-2 py-0.5 text-xs text-brand">
      <Num>{children}</Num>
    </span>
  )
}
