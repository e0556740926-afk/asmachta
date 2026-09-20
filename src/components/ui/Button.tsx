import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'quiet'
}

export function Button({ variant = 'default', className = '', ...props }: Props) {
  const base =
    'inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 disabled:cursor-not-allowed'
  const variants: Record<string, string> = {
    default: 'border-line bg-surface text-ink hover:border-brand hover:bg-tint',
    primary: 'border-brand bg-brand text-surface hover:opacity-90',
    quiet: 'border-transparent bg-transparent text-ink hover:bg-soft',
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}
