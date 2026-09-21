import { useEffect, useState } from 'react'
import { supabase, type Profile } from '../../lib/supabase'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, StatusChip } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'

export function UsersTab() {
  const { profile: myProfile, refreshProfile } = useAuth()
  const [users, setUsers] = useState<Profile[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    setUsers((data as Profile[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function updateUser(id: string, patch: Partial<Profile>) {
    setBusyId(id)
    await supabase.from('profiles').update(patch).eq('id', id)
    await load()
    if (id === myProfile?.id) await refreshProfile()
    setBusyId(null)
  }

  if (users === null) return null

  const pending = users.filter((u) => u.status === 'pending')
  const rest = users.filter((u) => u.status !== 'pending')

  function RoleStatusRow({ u }: { u: Profile }) {
    const isSelf = u.id === myProfile?.id
    return (
      <div className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
        <div className="min-w-0">
          <p className="truncate font-medium">{u.display_name || '—'}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <StatusChip tone={u.role === 'admin' ? 'gold' : 'default'}>
              {u.role === 'admin' ? t.admin.users.roleAdmin : t.admin.users.roleMember}
            </StatusChip>
            <StatusChip
              tone={u.status === 'active' ? 'brand' : u.status === 'pending' ? 'pending' : 'default'}
            >
              {u.status === 'active'
                ? t.admin.users.statusActive
                : u.status === 'pending'
                  ? t.admin.users.statusPending
                  : t.admin.users.statusBlocked}
            </StatusChip>
            {isSelf && <StatusChip>את/ה</StatusChip>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {u.status === 'pending' && (
            <>
              <Button variant="primary" disabled={busyId === u.id} onClick={() => updateUser(u.id, { status: 'active' })}>
                {t.admin.users.approve}
              </Button>
              <Button disabled={busyId === u.id} onClick={() => updateUser(u.id, { status: 'blocked' })}>
                {t.admin.users.reject}
              </Button>
            </>
          )}
          {u.status !== 'pending' && (
            <>
              <Button
                disabled={busyId === u.id}
                onClick={() => updateUser(u.id, { status: u.status === 'blocked' ? 'active' : 'blocked' })}
              >
                {u.status === 'blocked' ? t.admin.users.unblock : t.admin.users.block}
              </Button>
              <Button
                disabled={busyId === u.id}
                onClick={() => {
                  if (isSelf && u.role === 'admin' && !confirm(t.admin.users.confirmSelfDemote)) return
                  updateUser(u.id, { role: u.role === 'admin' ? 'member' : 'admin' })
                }}
              >
                {u.role === 'admin' ? t.admin.users.makeMember : t.admin.users.makeAdmin}
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-8">
      <div>
        <h2 className="mb-3 font-display text-lg font-medium">{t.admin.users.pendingSection}</h2>
        <Card>
          {pending.length === 0 ? (
            <EmptyState title={t.admin.users.pendingEmpty} />
          ) : (
            pending.map((u) => <RoleStatusRow key={u.id} u={u} />)
          )}
        </Card>
      </div>
      <div>
        <h2 className="mb-3 font-display text-lg font-medium">{t.admin.users.allSection}</h2>
        <Card>{rest.map((u) => <RoleStatusRow key={u.id} u={u} />)}</Card>
      </div>
    </div>
  )
}
