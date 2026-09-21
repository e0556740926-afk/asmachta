import type { ReactNode } from 'react'

/** A single row in a hierarchical topic tree (used by the M2 topic-tree editor and reader). */
export function TreeRow({
  label,
  depth = 0,
  expanded,
  onToggle,
  hasChildren = false,
  trailing,
}: {
  label: ReactNode
  depth?: number
  expanded?: boolean
  onToggle?: () => void
  hasChildren?: boolean
  trailing?: ReactNode
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-md py-1.5 pe-2 text-sm hover:bg-soft"
      style={{ paddingInlineStart: `${depth * 20 + 8}px` }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="grid h-5 w-5 shrink-0 place-items-center text-muted transition-transform"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ‹
        </button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </div>
  )
}
