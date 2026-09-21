import { useEffect, useState } from 'react'
import { supabase, type AppSettings } from '../../lib/supabase'
import { Card } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'

export function SettingsTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saved, setSaved] = useState(false)

  async function load() {
    const { data } = await supabase.from('app_settings').select('*').eq('id', true).maybeSingle()
    setSettings(data as AppSettings | null)
  }

  useEffect(() => {
    load()
  }, [])

  async function toggle() {
    if (!settings) return
    const next = !settings.require_signup_approval
    setSettings({ ...settings, require_signup_approval: next })
    await supabase.from('app_settings').update({ require_signup_approval: next }).eq('id', true)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  if (!settings) return null

  return (
    <Card className="grid gap-2">
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="block font-medium">{t.admin.settings.requireApproval}</span>
          <span className="block text-sm text-muted">{t.admin.settings.requireApprovalHint}</span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0"
          checked={settings.require_signup_approval}
          onChange={toggle}
        />
      </label>
      {saved && <p className="text-xs text-brand">{t.admin.settings.saved}</p>}
    </Card>
  )
}
