import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'

export function PendingPage() {
  const { signOut } = useAuth()
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <Card className="w-full max-w-sm text-center">
        <h1 className="mb-3 font-display text-xl font-medium">{t.pending.title}</h1>
        <p className="mb-6 text-muted">{t.pending.body}</p>
        <Button onClick={signOut}>{t.pending.signOut}</Button>
      </Card>
    </div>
  )
}
