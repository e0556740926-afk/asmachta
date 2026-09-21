export type Theme = 'light' | 'dark' | 'system'
export type Direction = 'library' | 'studio'

const THEME_KEY = 'asmachta-theme'
const DIRECTION_KEY = 'asmachta-direction'

export function getStoredTheme(): Theme {
  return (localStorage.getItem(THEME_KEY) as Theme) || 'system'
}

export function getStoredDirection(): Direction {
  return (localStorage.getItem(DIRECTION_KEY) as Direction) || 'library'
}

export function applyTheme(theme: Theme) {
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
}

export function applyDirection(direction: Direction) {
  document.documentElement.classList.toggle('studio', direction === 'studio')
}

export function storeTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme)
}

export function storeDirection(direction: Direction) {
  localStorage.setItem(DIRECTION_KEY, direction)
}
