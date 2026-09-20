import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[var(--radius-token)] border border-line bg-surface p-6 ${className}`}>
      {children}
    </div>
  )
}

export function StatusChip({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'brand' | 'gold' | 'pending'
}) {
  const tones: Record<string, string> = {
    default: 'bg-soft text-ink',
    brand: 'bg-tint text-brand',
    gold: 'bg-goldbg text-gold',
    pending: 'bg-goldbg text-gold',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-soft ${className}`} />
}

export function EmptyState({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[var(--radius-token)] border border-dashed border-line py-16 text-center text-muted">
      <p>{title}</p>
      {action}
    </div>
  )
}

/** Wraps embedded numbers / case citations / Latin runs inside Hebrew text (bidi isolation). */
export function Num({ children }: { children: ReactNode }) {
  return <bdi className="ltr-run">{children}</bdi>
}
