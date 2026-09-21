import { useSearchParams } from 'react-router-dom'
import { t } from '../../i18n/he'
import { UsersTab } from './UsersTab'
import { CoursesTab } from './CoursesTab'
import { SettingsTab } from './SettingsTab'

const TABS = [
  { key: 'users', label: t.admin.tabs.users },
  { key: 'courses', label: t.admin.tabs.courses },
  { key: 'settings', label: t.admin.tabs.settings },
] as const

export function AdminPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as (typeof TABS)[number]['key']) || 'users'

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 pb-24 md:px-10">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-medium">{t.admin.title}</h1>
        <p className="text-sm text-muted">{t.admin.subtitle}</p>
      </div>
      <div className="mb-7 flex gap-6 overflow-auto border-b border-line">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setParams({ tab: tb.key })}
            className={`whitespace-nowrap border-b-2 pb-3 text-sm ${
              tb.key === tab ? 'border-brand font-semibold text-brand' : 'border-transparent text-muted'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'courses' && <CoursesTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}
