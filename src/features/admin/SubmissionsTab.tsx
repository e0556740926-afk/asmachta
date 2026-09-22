import { useEffect, useState } from 'react'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Skeleton, StatusChip } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'
import { decideSubmission, fetchPendingSubmissions } from '../../lib/submissions'
import type { SubmissionWithProfiles } from '../../lib/supabase'

function typeLabel(type: string | null): string {
  switch (type) {
    case 'summary':
      return t.admin.submissions.typeSummary
    case 'note':
      return t.admin.submissions.typeNote
    case 'question':
      return t.admin.submissions.typeQuestion
    case 'ruling':
      return t.admin.submissions.typeRuling
    default:
      return type ?? ''
  }
}

/** Admin moderation queue: every pending community submission, across all courses, with
 * approve/reject actions. Wires up the existing submissions table's admin-review workflow. */
export function SubmissionsTab() {
  const { profile } = useAuth()
  const [items, setItems] = useState<(SubmissionWithProfiles & { courses: { title: string } | null })[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    const rows = await fetchPendingSubmissions()
    setItems(rows)
  }

  useEffect(() => {
    load()
  }, [])

  async function onApprove(id: string) {
    if (!profile) return
    setBusyId(id)
    try {
      await decideSubmission(id, profile.id, 'approved', null)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function onReject(id: string) {
    if (!profile) return
    const reason = window.prompt(t.admin.submissions.rejectReasonPrompt) ?? ''
    setBusyId(id)
    try {
      await decideSubmission(id, profile.id, 'rejected', reason.trim() || null)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">{t.admin.submissions.subtitle}</p>
      {items === null ? (
        <div className="grid gap-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t.admin.submissions.empty} />
      ) : (
        <div className="grid gap-3">
          {items.map((s) => (
            <Card key={s.id} className="grid min-w-0 gap-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusChip>{typeLabel(s.type)}</StatusChip>
                  <span className="text-xs text-muted">{s.courses?.title}</span>
                </div>
                <span className="text-xs text-muted">{s.uploader?.display_name ?? ''}</span>
              </div>
              <p className="font-medium break-words">{s.title}</p>
              <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-ink">{s.body_html}</p>
              <p className="text-xs text-muted">
                {s.rights_declared ? t.admin.submissions.rightsDeclared : t.admin.submissions.rightsNotDeclared}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="primary" onClick={() => onApprove(s.id)} disabled={busyId === s.id}>
                  {t.admin.submissions.approve}
                </Button>
                <Button type="button" variant="quiet" onClick={() => onReject(s.id)} disabled={busyId === s.id}>
                  {t.admin.submissions.reject}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
