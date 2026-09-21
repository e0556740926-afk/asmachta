import { useEffect, type ReactNode } from 'react'

/**
 * Slide-in panel anchored to the inline-end edge (or the bottom, on
 * `side="bottom"`) — used for the agent panel and similar overlays that
 * should stay next to the content rather than covering it, unlike Dialog.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  side = 'end',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  side?: 'end' | 'bottom'
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const panelPosition =
    side === 'end'
      ? 'inset-y-0 end-0 h-full w-full max-w-sm border-s'
      : 'inset-x-0 bottom-0 max-h-[85vh] w-full border-t'

  return (
    <div className="fixed inset-0 z-50 bg-ink/40" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute flex flex-col border-line bg-surface shadow-xl ${panelPosition}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line p-4">
          <h2 className="font-display text-lg font-medium">{title}</h2>
          <button aria-label="סגירה" className="text-muted hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  )
}
