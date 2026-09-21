import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabase'
import { Popover } from '../components/ui/Popover'
import { CommandPalette, type SearchPage } from '../components/search/CommandPalette'
import { useAgentPanel } from '../components/agent/AgentPanelContext'
import {
  applyDirection,
  applyTheme,
  getStoredDirection,
  getStoredTheme,
  storeDirection,
  storeTheme,
  type Direction,
  type Theme,
} from './theme'
import { t } from '../i18n/he'

function useThemeAndDirection() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme)
  const [direction, setDirection] = useState<Direction>(getStoredDirection)

  useEffect(() => {
    applyTheme(theme)
    storeTheme(theme)
  }, [theme])

  useEffect(() => {
    applyDirection(direction)
    storeDirection(direction)
  }, [direction])

  return { theme, setTheme, direction, setDirection }
}

/** Breadcrumb trail for the current route. Fetches the course title for /courses/:id (cheap, single-column select). */
function useBreadcrumb() {
  const location = useLocation()
  const [courseTitle, setCourseTitle] = useState<string | null>(null)

  useEffect(() => {
    const match = location.pathname.match(/^\/courses\/([^/]+)/)
    if (!match) {
      setCourseTitle(null)
      return
    }
    let cancelled = false
    supabase
      .from('courses')
      .select('title')
      .eq('id', match[1])
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCourseTitle((data as { title: string } | null)?.title ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  const crumbs: { label: string; to?: string }[] = [{ label: t.nav.home, to: '/' }]
  if (location.pathname.startsWith('/courses')) {
    crumbs.push({ label: t.nav.courses, to: location.pathname === '/courses' ? undefined : '/courses' })
    if (courseTitle) crumbs.push({ label: courseTitle })
  } else if (location.pathname.startsWith('/admin')) {
    crumbs.push({ label: t.nav.admin })
  } else if (location.pathname.startsWith('/design')) {
    crumbs.push({ label: t.nav.design })
  }
  return crumbs
}

export function Shell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { theme, setTheme, direction, setDirection } = useThemeAndDirection()
  const { openAgent } = useAgentPanel()
  const [searchOpen, setSearchOpen] = useState(false)
  const crumbs = useBreadcrumb()

  const navItems = [
    { to: '/', label: t.nav.home },
    { to: '/courses', label: t.nav.courses },
    ...(profile?.role === 'admin' ? [{ to: '/admin', label: t.nav.admin }] : []),
    ...(profile?.role === 'admin' ? [{ to: '/design', label: t.nav.design }] : []),
  ]
  const searchPages: SearchPage[] = navItems

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
        return
      }
      if (e.key === '/') {
        const target = e.target as HTMLElement | null
        const isTyping =
          target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (!isTyping) {
          e.preventDefault()
          setSearchOpen(true)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="grid min-h-screen md:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-e border-line bg-surface p-5 md:flex">
          <div className="flex items-center gap-2 font-display text-xl font-medium">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-surface">א</span>
            {t.appName}
          </div>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center justify-between rounded-md border border-line bg-bg px-3 py-2 text-start text-xs text-muted hover:border-brand hover:text-ink"
          >
            {t.search.placeholder}
          </button>
          <nav className="grid gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm ${isActive ? 'bg-tint font-semibold text-brand' : 'text-muted hover:bg-soft'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto border-t border-line pt-4">
            <Popover
              align="start"
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={t.shell.userMenu}
                  className="flex w-full items-center gap-2 rounded-md p-1.5 text-sm hover:bg-soft"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-tint text-brand">
                    {profile?.display_name?.[0] ?? '?'}
                  </span>
                  <span className="min-w-0 text-start">
                    <p className="truncate font-medium">{profile?.display_name}</p>
                    <p className="truncate text-xs text-muted">{profile?.role === 'admin' ? 'מנהל' : 'חבר'}</p>
                  </span>
                </button>
              )}
            >
              <div className="grid gap-2 p-2">
                <label className="grid gap-1 text-xs text-muted">
                  {t.theme.light}/{t.theme.dark}
                  <select
                    className="rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as Theme)}
                  >
                    <option value="light">{t.theme.light}</option>
                    <option value="dark">{t.theme.dark}</option>
                    <option value="system">{t.theme.system}</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs text-muted">
                  {t.direction.library}/{t.direction.studio}
                  <select
                    className="rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as Direction)}
                  >
                    <option value="library">{t.direction.library}</option>
                    <option value="studio">{t.direction.studio}</option>
                  </select>
                </label>
                <button
                  className="mt-1 rounded-md px-2 py-1.5 text-start text-sm text-muted hover:bg-soft hover:text-ink"
                  onClick={async () => {
                    await signOut()
                    navigate('/')
                  }}
                >
                  {t.shell.signOut}
                </button>
              </div>
            </Popover>
          </div>
        </aside>
        <main className="min-w-0">
          <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-surface/90 px-6 py-3 backdrop-blur md:px-10">
            <nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted">
              {crumbs.map((crumb, i) => (
                <span key={i} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <span aria-hidden="true">‹</span>}
                  {crumb.to ? (
                    <NavLink to={crumb.to} className="truncate hover:text-brand">
                      {crumb.label}
                    </NavLink>
                  ) : (
                    <span className="truncate text-ink">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => openAgent()}
                aria-label={t.shell.agent}
                title={t.nav.agent}
                className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-soft hover:text-brand"
              >
                ✦
              </button>
              <Popover
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label={t.shell.notifications}
                    title={t.shell.notifications}
                    className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-soft hover:text-brand"
                  >
                    🔔
                  </button>
                )}
              >
                <div className="p-3 text-sm text-muted">{t.shell.notificationsEmpty}</div>
              </Popover>
            </div>
          </div>
          {children}
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-line bg-surface md:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `text-xs ${isActive ? 'text-brand' : 'text-muted'}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} pages={searchPages} />
    </div>
  )
}
