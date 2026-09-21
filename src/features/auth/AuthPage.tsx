import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'

export function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function onForgotSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    if (error) setError(t.auth.error)
    else setResetSent(true)
  }

  async function onGoogleSignIn() {
    setError(null)
    setGoogleBusy(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setError(t.auth.error)
      setGoogleBusy(false)
    }
    // On success the browser redirects to Google, so no further action here.
  }

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
          {mode === 'signin' ? t.auth.signInTitle : mode === 'signup' ? t.auth.signUpTitle : t.auth.forgotTitle}
        </h1>

        {mode === 'forgot' ? (
          resetSent ? (
            <p className="text-sm text-brand">{t.auth.forgotSent}</p>
          ) : (
            <form onSubmit={onForgotSubmit} className="grid gap-4">
              <p className="text-sm text-muted">{t.auth.forgotBody}</p>
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
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" variant="primary" disabled={busy}>
                {t.auth.forgotSubmit}
              </Button>
            </form>
          )
        ) : (
          <>
            <Button
              type="button"
              onClick={onGoogleSignIn}
              disabled={googleBusy}
              className="mb-4 w-full justify-center"
            >
              <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.12-.84 2.07-1.79 2.71v2.26h2.9c1.7-1.57 2.69-3.87 2.69-6.61z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.55-1.84.87-3.06.87-2.35 0-4.34-1.58-5.05-3.71H.9v2.33C2.38 15.98 5.44 18 9 18z" />
                <path fill="#FBBC05" d="M3.95 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.27-1.72V4.95H.9A8.96 8.96 0 0 0 0 9c0 1.45.35 2.83.9 4.05l3.05-2.33z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.57-2.57C13.46.89 11.43 0 9 0 5.44 0 2.38 2.02.9 4.95l3.05 2.33C4.66 5.16 6.65 3.58 9 3.58z" />
              </svg>
              {t.auth.continueWithGoogle}
            </Button>
            <div className="mb-4 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-line" />
              {t.auth.or}
              <span className="h-px flex-1 bg-line" />
            </div>
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
              {mode === 'signin' && (
                <button
                  type="button"
                  className="justify-self-start text-xs text-muted hover:text-brand"
                  onClick={() => {
                    setError(null)
                    setResetSent(false)
                    setMode('forgot')
                  }}
                >
                  {t.auth.forgotPassword}
                </button>
              )}
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
          </>
        )}

        <button
          className="mt-4 text-sm text-brand"
          onClick={() => {
            setError(null)
            setResetSent(false)
            setMode(mode === 'signup' ? 'signin' : mode === 'forgot' ? 'signin' : 'signup')
          }}
        >
          {mode === 'signin' ? t.auth.switchToSignUp : mode === 'signup' ? t.auth.switchToSignIn : t.auth.backToSignIn}
        </button>
      </Card>
    </div>
  )
}
