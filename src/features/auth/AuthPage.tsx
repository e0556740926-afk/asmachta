import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'

export function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        if (!consent) {
          setError(t.auth.privacyConsent)
          setBusy(false)
          return
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch {
      setError(t.auth.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2 font-display text-2xl font-medium">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-surface">א</span>
          {t.appName}
        </div>
        <h1 className="mb-6 font-display text-xl font-medium">
          {mode === 'signin' ? t.auth.signInTitle : t.auth.signUpTitle}
        </h1>
        <form onSubmit={onSubmit} className="grid gap-4">
          {mode === 'signup' && (
            <label className="grid gap-1 text-sm">
              {t.auth.displayName}
              <input
                className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </label>
          )}
          <label className="grid gap-1 text-sm">
            {t.auth.email}
            <input
              type="email"
              className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="grid gap-1 text-sm">
            {t.auth.password}
            <input
              type="password"
              className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          {mode === 'signup' && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              {t.auth.privacyConsent}
            </label>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            {mode === 'signin' ? t.auth.signIn : t.auth.signUp}
          </Button>
        </form>
        <button
          className="mt-4 text-sm text-brand"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin' ? t.auth.switchToSignUp : t.auth.switchToSignIn}
        </button>
      </Card>
    </div>
  )
}
