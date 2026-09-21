import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './app/AuthContext'
import { Shell } from './app/Shell'
import { applyDirection, applyTheme, getStoredDirection, getStoredTheme } from './app/theme'
import { AuthPage } from './features/auth/AuthPage'
import { PendingPage } from './features/auth/PendingPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { HomePage } from './features/home/HomePage'
import { CoursesPage } from './features/courses/CoursesPage'
import { CoursePage } from './features/courses/CoursePage'
import { AdminPage } from './features/admin/AdminPage'
import { DesignPage } from './features/design/DesignPage'
import { ToastProvider } from './components/ui/Toast'
import { AgentPanelProvider } from './components/agent/AgentPanelContext'

function AdminGate() {
  const { profile } = useAuth()
  if (profile?.role !== 'admin') return <Navigate to="/" replace />
  return <AdminPage />
}

function Gate() {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  // Reached via the Supabase password-recovery email link. Must stay
  // reachable regardless of auth state (supabase-js sets a temporary
  // session from the URL fragment on load), so this check comes first.
  if (location.pathname === '/reset-password') return <ResetPasswordPage />

  if (loading) return null
  if (!session) return <AuthPage />
  if (!profile || profile.status === 'pending') return <PendingPage />
  if (profile.status === 'blocked') return <PendingPage />

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/courses" element={<CoursesPage />} />
        <Route path="/courses/:id" element={<CoursePage />} />
        <Route path="/admin" element={<AdminGate />} />
        <Route path="/design" element={<DesignPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

/**
 * Applies the stored theme/direction to <html> on every screen, including
 * ones Shell never renders (sign-in, pending, reset-password) — otherwise
 * those screens ignore both the user's saved preference and a "system"
 * dark-mode preference. Also tracks live OS theme changes while "system"
 * is selected. Shell owns the actual toggle controls for authenticated
 * users; this just makes sure the preference is always applied.
 */
function useGlobalTheme() {
  useEffect(() => {
    applyTheme(getStoredTheme())
    applyDirection(getStoredDirection())
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (getStoredTheme() === 'system') applyTheme('system')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
}

export default function App() {
  useGlobalTheme()
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AgentPanelProvider>
            <Gate />
          </AgentPanelProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
