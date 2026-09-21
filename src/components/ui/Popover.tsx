import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Click-triggered, non-modal popover. `trigger` is a render-prop so the
 * caller controls the trigger element (button, avatar, icon...) while
 * this component owns open state and outside-click / Escape handling.
 */
export function Popover({
  trigger,
  children,
  align = 'end',
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  children: ReactNode
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative inline-block" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-40 mt-2 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-lg ${
            align === 'end' ? 'end-0' : 'start-0'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
