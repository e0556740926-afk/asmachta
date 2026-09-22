import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Skeleton, StatusChip } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'
import { fetchTopics } from '../../lib/topics'
import {
  createLinkSubmission,
  createSubmission,
  deleteSubmission,
  extractSubmissionText,
  fetchCourseSubmissions,
  fetchFlagsForCourse,
  flagSubmission,
} from '../../lib/submissions'
import type { SubmissionFlag, SubmissionType, SubmissionWithProfiles, TopicWithSections } from '../../lib/supabase'

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

function mapExtractError(code: string): string {
  switch (code) {
    case 'google_doc_not_accessible':
      return t.shared.extractErrorGoogleDoc
    case 'empty_text':
      return t.shared.extractErrorEmpty
    default:
      return t.shared.extractErrorGeneric
  }
}

type Folder = { uploaderId: string; uploaderName: string; items: SubmissionWithProfiles[] }

/**
 * "Shared" tab, redesigned around three views instead of one long, truncated-card list:
 *  1. list — the add-form, "my submissions" (pending/rejected, not yet public), and folders of
 *     approved/merged content grouped by whoever shared it (per course — "Nurit's folder" holding
 *     everything Nurit shared).
 *  2. folder — one uploader's shared items.
 *  3. reader — a single submission's full text, not squeezed into a card; also where "reorganize"
 *     (retry text extraction for a Google Docs link) and "report a mistake" live.
 * A submission's source is either typed text (body_html filled in immediately) or a Google Docs
 * link (document_id set, body_html filled in async by the extract-submission-text edge function —
 * kept deliberately separate from organize-summary, which is admin-only and writes into the
 * curated topic map; community submissions must never touch that before an admin approves them).
 */
export function SharedPanel({ courseId }: { courseId: string }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [items, setItems] = useState<SubmissionWithProfiles[] | null>(null)
  const [flags, setFlags] = useState<SubmissionFlag[]>([])
  const [topics, setTopics] = useState<TopicWithSections[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [linkMode, setLinkMode] = useState(false)
  const [type, setType] = useState<SubmissionType>('note')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [topicId, setTopicId] = useState('')
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<'list' | 'folder' | 'reader'>('list')
  const [selectedUploaderId, setSelectedUploaderId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [extractingId, setExtractingId] = useState<string | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)

  const [reportOpen, setReportOpen] = useState(false)
  const [reportNote, setReportNote] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportDone, setReportDone] = useState(false)

  async function load() {
    const [rows, flagRows] = await Promise.all([fetchCourseSubmissions(courseId), fetchFlagsForCourse(courseId).catch(() => [])])
    setItems(rows)
    setFlags(flagRows)
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
    if (!title.trim()) return
    if (!linkMode && !body.trim()) return
    if (linkMode && !/^https?:\/\//i.test(linkUrl.trim())) {
      setError(t.shared.linkInvalid)
      return
    }
    if (!rights) {
      setError(t.shared.rightsRequired)
      return
    }
    setBusy(true)
    setError(null)
    let submissionId: string | null = null
    try {
      if (linkMode) {
        const result = await createLinkSubmission({
          courseId,
          uploaderId: profile.id,
          type,
          title: title.trim(),
          googleDocsUrl: linkUrl.trim(),
          topicId: topicId || null,
          rightsDeclared: rights,
        })
        submissionId = result.submissionId
      } else {
        await createSubmission({
          courseId,
          uploaderId: profile.id,
          type,
          title: title.trim(),
          bodyHtml: body.trim(),
          topicId: topicId || null,
          rightsDeclared: rights,
        })
      }
      setTitle('')
      setBody('')
      setLinkUrl('')
      setTopicId('')
      setRights(false)
      setFormOpen(false)
      setLinkMode(false)
      await load()
    } catch {
      setError(t.shared.submitError)
    } finally {
      setBusy(false)
    }

    if (submissionId) await onExtract(submissionId)
  }

  async function onExtract(submissionId: string) {
    setExtractingId(submissionId)
    setExtractError(null)
    try {
      const result = await extractSubmissionText(submissionId)
      if ('error' in result) setExtractError(mapExtractError(result.error))
      else await load()
    } catch {
      setExtractError(t.shared.extractErrorGeneric)
    } finally {
      setExtractingId(null)
    }
  }

  async function onDelete(id: string) {
    await deleteSubmission(id)
    if (selectedItemId === id) {
      setView(selectedUploaderId ? 'folder' : 'list')
      setSelectedItemId(null)
    }
    await load()
  }

  async function onReport(e: React.FormEvent) {
    e.preventDefault()
    if (!profile || !selectedItemId || !reportNote.trim()) return
    setReportBusy(true)
    setReportError(null)
    try {
      await flagSubmission(selectedItemId, profile.id, reportNote.trim())
      setReportNote('')
      setReportOpen(false)
      setReportDone(true)
      await load()
    } catch {
      setReportError(t.shared.reportError)
    } finally {
      setReportBusy(false)
    }
  }

  const mine = useMemo(
    () => (items ?? []).filter((s) => s.uploader_id === profile?.id && s.status !== 'approved' && s.status !== 'merged'),
    [items, profile?.id]
  )

  const folders = useMemo<Folder[]>(() => {
    const approved = (items ?? []).filter((s) => s.status === 'approved' || s.status === 'merged')
    const byUploader = new Map<string, Folder>()
    for (const s of approved) {
      const existing = byUploader.get(s.uploader_id)
      if (existing) existing.items.push(s)
      else byUploader.set(s.uploader_id, { uploaderId: s.uploader_id, uploaderName: s.uploader?.display_name ?? '', items: [s] })
    }
    return Array.from(byUploader.values()).sort((a, b) => a.uploaderName.localeCompare(b.uploaderName, 'he'))
  }, [items])

  const selectedFolder = folders.find((f) => f.uploaderId === selectedUploaderId) ?? null
  const selectedItem = (items ?? []).find((s) => s.id === selectedItemId) ?? null
  const itemFlags = selectedItemId ? flags.filter((f) => f.submission_id === selectedItemId) : []
  const canSeeFlags = !!selectedItem && (isAdmin || selectedItem.uploader_id === profile?.id)

  function openItem(id: string, uploaderId: string) {
    setSelectedItemId(id)
    setSelectedUploaderId(uploaderId)
    setView('reader')
    setReportOpen(false)
    setReportDone(false)
    setReportError(null)
  }

  if (items === null) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    )
  }

  // ------------------------------------------------------------
  // Reader view — one submission's full text, own screen (not a truncated card).
  // ------------------------------------------------------------
  if (view === 'reader' && selectedItem) {
    const hasLink = !!selectedItem.document_id
    const canRetry = hasLink && (isAdmin || selectedItem.uploader_id === profile?.id)
    return (
      <div className="grid gap-4">
        <button
          type="button"
          onClick={() => {
            setView('folder')
            setSelectedItemId(null)
          }}
          className="justify-self-start text-sm text-brand hover:underline"
        >
          {t.shared.backToFolder}
        </button>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={statusTone(selectedItem.status)}>{statusLabel(selectedItem.status)}</StatusChip>
            {selectedItem.type && (
              <span className="text-xs text-muted">
                {selectedItem.type === 'summary' ? t.shared.typeSummary : selectedItem.type === 'note' ? t.shared.typeNote : t.shared.typeQuestion}
              </span>
            )}
          </div>
          <h2 className="mt-2 font-display text-xl font-medium break-words">{selectedItem.title}</h2>
          <p className="text-xs text-muted">{selectedItem.uploader?.display_name ?? ''}</p>
        </div>

        {selectedItem.status === 'rejected' && selectedItem.decision_reason && (
          <p className="text-sm text-red-600">
            {t.shared.decisionReasonPrefix} {selectedItem.decision_reason}
          </p>
        )}

        <Card className="grid gap-3">
          {extractingId === selectedItem.id ? (
            <p className="text-sm text-muted">{t.shared.extracting}</p>
          ) : selectedItem.body_html ? (
            <p className="whitespace-pre-wrap break-words text-sm text-ink">{selectedItem.body_html}</p>
          ) : (
            <EmptyState title={t.shared.noTextYet} />
          )}
          {extractError && <p className="text-sm text-red-600">{extractError}</p>}
          <div className="flex flex-wrap gap-2">
            {canRetry && (
              <Button type="button" variant="quiet" onClick={() => onExtract(selectedItem.id)} disabled={extractingId === selectedItem.id}>
                {t.shared.reorganize}
              </Button>
            )}
            {selectedItem.uploader_id === profile?.id && (
              <Button type="button" variant="quiet" onClick={() => onDelete(selectedItem.id)}>
                {t.shared.deleteMine}
              </Button>
            )}
          </div>
        </Card>

        <Card className="grid gap-3">
          {!reportOpen ? (
            <div className="flex items-center justify-between gap-3">
              <Button type="button" variant="quiet" onClick={() => setReportOpen(true)}>
                {t.shared.reportButton}
              </Button>
              {reportDone && <span className="text-sm text-brand">{t.shared.reportSuccess}</span>}
            </div>
          ) : (
            <form onSubmit={onReport} className="grid gap-2">
              <p className="text-xs text-muted">{t.shared.reportIntro}</p>
              <textarea
                className="min-h-20 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                placeholder={t.shared.reportPlaceholder}
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                disabled={reportBusy}
              />
              {reportError && <p className="text-sm text-red-600">{reportError}</p>}
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={reportBusy || !reportNote.trim()}>
                  {reportBusy ? t.shared.reportSubmitting : t.shared.reportSubmit}
                </Button>
                <Button type="button" variant="quiet" onClick={() => setReportOpen(false)} disabled={reportBusy}>
                  {t.shared.reportCancel}
                </Button>
              </div>
            </form>
          )}

          {canSeeFlags && itemFlags.length > 0 && (
            <div className="grid gap-2 border-t border-line pt-3">
              <h3 className="text-sm font-medium text-muted">{t.shared.flagsTitle}</h3>
              {itemFlags.map((f) => (
                <div key={f.id} className="rounded-md bg-soft p-2 text-sm">
                  <p className="break-words">{f.note}</p>
                  <p className="text-xs text-muted">{f.flagger?.display_name ?? ''}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    )
  }

  // ------------------------------------------------------------
  // Folder view — one uploader's shared items.
  // ------------------------------------------------------------
  if (view === 'folder' && selectedFolder) {
    return (
      <div className="grid gap-4">
        <button
          type="button"
          onClick={() => {
            setView('list')
            setSelectedUploaderId(null)
          }}
          className="justify-self-start text-sm text-brand hover:underline"
        >
          {t.shared.backToFolders}
        </button>
        <h2 className="font-display text-lg font-medium">{selectedFolder.uploaderName}</h2>
        <div className="grid gap-2">
          {selectedFolder.items.map((s) => (
            <Card key={s.id} className="p-4">
              <button type="button" onClick={() => openItem(s.id, s.uploader_id)} className="grid w-full gap-1 text-start">
                <p className="truncate font-medium hover:underline">{s.title}</p>
                <p className="truncate text-xs text-muted">
                  {s.type === 'summary' ? t.shared.typeSummary : s.type === 'note' ? t.shared.typeNote : t.shared.typeQuestion}
                </p>
              </button>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------
  // List view — add form, my (unpublished) submissions, folders of approved content.
  // ------------------------------------------------------------
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
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={linkMode ? 'quiet' : 'primary'} onClick={() => setLinkMode(false)} disabled={busy}>
                {t.shared.addFromText}
              </Button>
              <Button type="button" variant={linkMode ? 'primary' : 'quiet'} onClick={() => setLinkMode(true)} disabled={busy}>
                {t.shared.addFromLink}
              </Button>
            </div>
            {linkMode ? (
              <input
                className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                placeholder={t.shared.linkUrlPlaceholder}
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                disabled={busy}
              />
            ) : (
              <textarea
                className="min-h-28 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                placeholder={t.shared.bodyPlaceholder}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
              />
            )}
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
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setFormOpen(false)
                  setLinkMode(false)
                }}
                disabled={busy}
              >
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
                <p className="truncate font-medium">{s.title}</p>
                <StatusChip tone={statusTone(s.status)}>{statusLabel(s.status)}</StatusChip>
              </div>
              {extractingId === s.id ? (
                <p className="text-sm text-muted">{t.shared.extracting}</p>
              ) : s.body_html ? (
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted">{s.body_html}</p>
              ) : s.document_id ? (
                <p className="text-sm text-muted">{t.shared.noTextYet}</p>
              ) : null}
              {s.status === 'rejected' && s.decision_reason && (
                <p className="text-xs text-red-600">
                  {t.shared.decisionReasonPrefix} {s.decision_reason}
                </p>
              )}
              <div className="flex flex-wrap gap-2 justify-self-start">
                {s.document_id && (
                  <Button type="button" variant="quiet" onClick={() => onExtract(s.id)} disabled={extractingId === s.id}>
                    {t.shared.reorganize}
                  </Button>
                )}
                <Button type="button" variant="quiet" onClick={() => onDelete(s.id)}>
                  {t.shared.deleteMine}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-2">
        <h3 className="text-sm font-medium text-muted">{t.shared.foldersTitle}</h3>
        {folders.length === 0 ? (
          <EmptyState title={t.shared.communityEmpty} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((f) => (
              <Card key={f.uploaderId} className="grid gap-1 p-4">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedUploaderId(f.uploaderId)
                    setView('folder')
                  }}
                  className="grid gap-1 text-start"
                >
                  <span className="flex items-center gap-2 font-medium hover:underline">
                    <span aria-hidden="true">📁</span> {f.uploaderName}
                  </span>
                  <span className="text-xs text-muted">
                    {f.items.length} {t.shared.folderItemsCount}
                  </span>
                </button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
