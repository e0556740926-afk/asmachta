import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'

/**
 * Reached via the link in the Supabase "reset password" email
 * (redirectTo=/reset-password). supabase-js parses the recovery
 * tokens from the URL fragment on load and establishes a temporary
 * session automatically, so all this page needs to do is set a new
 * password on that session.
 */
export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError(t.auth.resetPasswordTooShort)
      return
    }
    if (password !== confirm) {
      setError(t.auth.resetPasswordMismatch)
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setError(t.auth.error)
      return
    }
    setDone(true)
    setTimeout(() => navigate('/', { replace: true }), 1500)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2 font-display text-2xl font-medium">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-surface">א</span>
          {t.appName}
        </div>
        <h1 className="mb-6 font-display text-xl font-medium">{t.auth.resetPasswordTitle}</h1>
        {done ? (
          <p className="text-sm text-brand">{t.auth.resetPasswordDone}</p>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
            <label className="grid gap-1 text-sm">
              {t.auth.resetPasswordNew}
              <input
                type="password"
                className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t.auth.resetPasswordConfirm}
              <input
                type="password"
                className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={6}
                required
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" variant="primary" disabled={busy}>
              {t.auth.resetPasswordSubmit}
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
