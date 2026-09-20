import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './app/AuthContext'
import { Shell } from './app/Shell'
import { AuthPage } from './features/auth/AuthPage'
import { PendingPage } from './features/auth/PendingPage'
import { HomePage } from './features/home/HomePage'
import { CoursesPage } from './features/courses/CoursesPage'
import { CoursePage } from './features/courses/CoursePage'

function Gate() {
  const { session, profile, loading } = useAuth()

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}
