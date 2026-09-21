import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, type Course } from '../../lib/supabase'
import { t } from '../../i18n/he'

export type SearchPage = { label: string; to: string }

/**
 * Navigation-only command palette (M1-11): jumps to nav pages and courses.
 * Opened externally (Shell owns the ⌘K listener and the trigger button) so
 * it stays a pure, controlled overlay.
 */
export function CommandPalette({
  open,
  onClose,
  pages,
}: {
  open: boolean
  onClose: () => void
  pages: SearchPage[]
}) {
  const [query, setQuery] = useState('')
  const [courses, setCourses] = useState<Course[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    supabase
      .from('courses')
      .select('*')
      .eq('archived', false)
      .order('position')
      .then(({ data }) => setCourses((data as Course[]) ?? []))
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0)
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(focusTimer)
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const filteredPages = pages.filter((p) => p.label.includes(query))
  const filteredCourses = courses.filter((c) => c.title.includes(query))
  const total = filteredPages.length + filteredCourses.length

  function select(to: string) {
    onClose()
    navigate(to)
  }

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const all = [...filteredPages.map((p) => p.to), ...filteredCourses.map((c) => `/courses/${c.id}`)]
      const to = all[activeIndex]
      if (to) select(to)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid justify-center bg-ink/40 p-4 pt-24"
      style={{ alignContent: 'start' }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.search.open}
        className="w-full max-w-lg overflow-hidden rounded-[var(--radius-token)] border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={onInputKeyDown}
          placeholder={t.search.placeholder}
          className="w-full border-b border-line bg-transparent px-4 py-3 text-ink outline-none"
        />
        <div className="max-h-80 overflow-auto p-2">
          {total === 0 && <p className="p-4 text-center text-sm text-muted">{t.search.empty}</p>}
          {filteredPages.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-xs text-muted">{t.search.pagesGroup}</p>
              {filteredPages.map((p, i) => {
                const idx = i
                return (
                  <button
                    key={p.to}
                    type="button"
                    onClick={() => select(p.to)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`block w-full rounded-md px-3 py-2 text-start text-sm ${
                      idx === activeIndex ? 'bg-tint text-brand' : 'hover:bg-soft'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          )}
          {filteredCourses.length > 0 && (
            <div>
              <p className="px-2 py-1 text-xs text-muted">{t.search.coursesGroup}</p>
              {filteredCourses.map((c, i) => {
                const idx = filteredPages.length + i
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => select(`/courses/${c.id}`)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`block w-full rounded-md px-3 py-2 text-start text-sm ${
                      idx === activeIndex ? 'bg-tint text-brand' : 'hover:bg-soft'
                    }`}
                  >
                    {c.title}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
