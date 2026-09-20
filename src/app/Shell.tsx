import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { t } from '../i18n/he'

type Theme = 'light' | 'dark' | 'system'
type Direction = 'library' | 'studio'

function useThemeAndDirection() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('asmachta-theme') as Theme) || 'system')
  const [direction, setDirection] = useState<Direction>(
    () => (localStorage.getItem('asmachta-direction') as Direction) || 'library',
  )

  useEffect(() => {
    const isDark =
      theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('asmachta-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.classList.toggle('studio', direction === 'studio')
    localStorage.setItem('asmachta-direction', direction)
  }, [direction])

  return { theme, setTheme, direction, setDirection }
}

const navItems = [
  { to: '/', label: t.nav.home },
  { to: '/courses', label: t.nav.courses },
]

export function Shell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { theme, setTheme, direction, setDirection } = useThemeAndDirection()

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="grid min-h-screen md:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-e border-line bg-surface p-5 md:flex">
          <div className="flex items-center gap-2 font-display text-xl font-medium">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-surface">א</span>
            {t.appName}
          </div>
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
          <div className="mt-auto grid gap-2 border-t border-line pt-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full border border-line bg-tint text-brand">
                {profile?.display_name?.[0] ?? '?'}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{profile?.display_name}</p>
                <p className="truncate text-xs text-muted">{profile?.role === 'admin' ? 'מנהל' : 'חבר'}</p>
              </div>
            </div>
            <select
              className="rounded-md border border-line bg-bg px-2 py-1 text-xs"
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
            >
              <option value="light">{t.theme.light}</option>
              <option value="dark">{t.theme.dark}</option>
              <option value="system">{t.theme.system}</option>
            </select>
            <select
              className="rounded-md border border-line bg-bg px-2 py-1 text-xs"
              value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
            >
              <option value="library">{t.direction.library}</option>
              <option value="studio">{t.direction.studio}</option>
            </select>
            <button
              className="text-start text-xs text-muted hover:text-ink"
              onClick={async () => {
                await signOut()
                navigate('/')
              }}
            >
              התנתקות
            </button>
          </div>
        </aside>
        <main className="min-w-0">{children}</main>
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
    </div>
  )
}
