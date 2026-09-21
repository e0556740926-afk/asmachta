import { useEffect, useState } from 'react'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Skeleton, StatusChip } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'
import { fetchTopics } from '../../lib/topics'
import { createSubmission, deleteSubmission, fetchCourseSubmissions } from '../../lib/submissions'
import type { SubmissionType, SubmissionWithProfiles, TopicWithSections } from '../../lib/supabase'

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return t.shared.statusPending
    case 'approved':
      return t.shared.statusApproved
    case 'rejected':
      return t.shared.statusRejected
    case 'merged':
      return t.shared.statusMerged
    default:
      return status
  }
}

function statusTone(status: string): 'default' | 'brand' | 'gold' | 'pending' {
  switch (status) {
    case 'approved':
    case 'merged':
      return 'brand'
    case 'pending':
      return 'pending'
    default:
      return 'default'
  }
}

/**
 * "Shared" tab: members can submit content (a note, question or short summary, optionally tied to
 * a topic) for the course; every submission starts `pending` (enforced server-side by a trigger)
 * until an admin approves or rejects it. Wires up the existing submissions table — RLS already
 * scopes a single query to "my submissions (any status) + everyone's approved/merged ones", so no
 * client-side status filtering is needed for correctness, only for grouping the display.
 */
export function SharedPanel({ courseId }: { courseId: string }) {
  const { profile } = useAuth()
  const [items, setItems] = useState<SubmissionWithProfiles[] | null>(null)
  const [topics, setTopics] = useState<TopicWithSections[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [type, setType] = useState<SubmissionType>('note')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [topicId, setTopicId] = useState('')
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const rows = await fetchCourseSubmissions(courseId)
    setItems(rows)
  }

  useEffect(() => {
    load()
    fetchTopics(courseId)
      .then(setTopics)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    if (!title.trim() || !body.trim()) return
    if (!rights) {
      setError(t.shared.rightsRequired)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createSubmission({
        courseId,
        uploaderId: profile.id,
        type,
        title: title.trim(),
        bodyHtml: body.trim(),
        topicId: topicId || null,
        rightsDeclared: rights,
      })
      setTitle('')
      setBody('')
      setTopicId('')
      setRights(false)
      setFormOpen(false)
      await load()
    } catch {
      setError(t.shared.submitError)
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string) {
    await deleteSubmission(id)
    await load()
  }

  if (items === null) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    )
  }

  const approved = items.filter((s) => s.status === 'approved' || s.status === 'merged')
  const mine = items.filter((s) => s.uploader_id === profile?.id && s.status !== 'approved' && s.status !== 'merged')

  return (
    <div className="grid gap-6">
      <Card className="grid gap-3">
        <p className="text-sm text-muted">{t.shared.intro}</p>
        {!formOpen ? (
          <Button type="button" variant="primary" onClick={() => setFormOpen(true)} className="justify-self-start">
            {t.shared.addButton}
          </Button>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {(['summary', 'note', 'question'] as SubmissionType[]).map((ty) => (
                <button
                  key={ty}
                  type="button"
                  onClick={() => setType(ty)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    type === ty ? 'border-brand bg-tint text-brand' : 'border-line text-muted'
                  }`}
                >
                  {ty === 'summary' ? t.shared.typeSummary : ty === 'note' ? t.shared.typeNote : t.shared.typeQuestion}
                </button>
              ))}
            </div>
            <input
              className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
              placeholder={t.shared.titlePlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
            <textarea
              className="min-h-28 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
              placeholder={t.shared.bodyPlaceholder}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={busy}
            />
            {topics.length > 0 && (
              <select
                className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                disabled={busy}
              >
                <option value="">{t.shared.topicNone}</option>
                {topics.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.title}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} disabled={busy} />
              {t.shared.rightsCheckbox}
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? t.shared.submitting : t.shared.submit}
              </Button>
              <Button type="button" variant="quiet" onClick={() => setFormOpen(false)} disabled={busy}>
                {t.shared.cancel}
              </Button>
            </div>
          </form>
        )}
      </Card>

      {mine.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium text-muted">{t.shared.mySection}</h3>
          {mine.map((s) => (
            <Card key={s.id} className="grid gap-1 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{s.title}</p>
                <StatusChip tone={statusTone(s.status)}>{statusLabel(s.status)}</StatusChip>
              </div>
              <p className="whitespace-pre-wrap text-sm text-muted">{s.body_html}</p>
              {s.status === 'rejected' && s.decision_reason && (
                <p className="text-xs text-red-600">
                  {t.shared.decisionReasonPrefix} {s.decision_reason}
                </p>
              )}
              <div className="justify-self-start">
                <Button type="button" variant="quiet" onClick={() => onDelete(s.id)}>
                  {t.shared.deleteMine}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-2">
        <h3 className="text-sm font-medium text-muted">{t.shared.communitySection}</h3>
        {approved.length === 0 ? (
          <EmptyState title={t.shared.communityEmpty} />
        ) : (
          approved.map((s) => (
            <Card key={s.id} className="grid gap-1 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{s.title}</p>
                <span className="text-xs text-muted">{s.uploader?.display_name ?? ''}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-ink">{s.body_html}</p>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
