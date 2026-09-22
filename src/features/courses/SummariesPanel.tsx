import { useEffect, useRef, useState } from 'react'
import { supabase, type SummaryWithFile } from '../../lib/supabase'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, StatusChip, Skeleton, Num } from '../../components/ui/Primitives'
import { addExternalDocument, getDownloadUrl, uploadDocument } from '../../lib/upload'
import { extractTextFromFile } from '../../lib/extractText'
import { organizeSummary } from '../../lib/topics'
import { TopicsPanel } from './TopicsPanel'
import { t } from '../../i18n/he'

function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function mapOrganizeError(code: string): string {
  switch (code) {
    case 'upstream_busy':
      return t.topics.organizeErrorBusy
    case 'google_doc_not_accessible':
      return t.topics.organizeErrorGoogleDoc
    case 'empty_text':
      return t.topics.organizeErrorExtractFailed
    default:
      return t.topics.organizeErrorGeneric
  }
}

export function SummariesPanel({ courseId }: { courseId: string }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [items, setItems] = useState<SummaryWithFile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkMode, setLinkMode] = useState(false)
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Topic-organization: runs automatically after every upload/link add, and can be re-run per
  // document via the "reorganize" button (also how already-uploaded documents get backfilled).
  const [organizing, setOrganizing] = useState(false)
  const [orgError, setOrgError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  async function load() {
    const { data } = await supabase
      .from('summaries')
      .select('*, documents(*, blobs(*))')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false })
    setItems((data as SummaryWithFile[] | null) ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile) return
    setBusy(true)
    setError(null)
    setOrgError(null)
    let summaryId: string | null = null
    try {
      const { documentId } = await uploadDocument(file, { kind: 'summary', ownerId: profile.id, visibility: 'core' })
      const title = file.name.replace(/\.[^./]+$/, '')
      const { data: inserted, error: insertError } = await supabase
        .from('summaries')
        .insert({ course_id: courseId, document_id: documentId, title, status: 'published' })
        .select('id')
        .single()
      if (insertError) throw insertError
      summaryId = (inserted as { id: string }).id
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
    }

    if (summaryId) {
      setOrganizing(true)
      try {
        const text = await extractTextFromFile(file)
        if (!text) {
          setOrgError(t.topics.organizeErrorExtractFailed)
        } else {
          const result = await organizeSummary(summaryId, { text })
          if ('error' in result) setOrgError(mapOrganizeError(result.error))
          else setRefreshKey((k) => k + 1)
        }
      } catch {
        setOrgError(t.topics.organizeErrorGeneric)
      } finally {
        setOrganizing(false)
      }
    }
  }

  async function onAddLink(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    if (!linkTitle.trim()) {
      setError(t.course.linkTitleRequired)
      return
    }
    if (!/^https?:\/\//i.test(linkUrl.trim())) {
      setError(t.course.linkInvalid)
      return
    }
    setBusy(true)
    setError(null)
    setOrgError(null)
    let summaryId: string | null = null
    const urlForOrganize = linkUrl.trim()
    try {
      const { documentId } = await addExternalDocument(linkUrl, { kind: 'summary', ownerId: profile.id, visibility: 'core' })
      const { data: inserted, error: insertError } = await supabase
        .from('summaries')
        .insert({ course_id: courseId, document_id: documentId, title: linkTitle.trim(), status: 'published' })
        .select('id')
        .single()
      if (insertError) throw insertError
      summaryId = (inserted as { id: string }).id
      setLinkTitle('')
      setLinkUrl('')
      setLinkMode(false)
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
    }

    if (summaryId) {
      setOrganizing(true)
      try {
        const result = await organizeSummary(summaryId, { googleDocsUrl: urlForOrganize })
        if ('error' in result) setOrgError(mapOrganizeError(result.error))
        else setRefreshKey((k) => k + 1)
      } catch {
        setOrgError(t.topics.organizeErrorGeneric)
      } finally {
        setOrganizing(false)
      }
    }
  }

  async function onReorganize(item: SummaryWithFile) {
    setOrganizing(true)
    setOrgError(null)
    try {
      let result: Awaited<ReturnType<typeof organizeSummary>>
      if (item.documents?.external_url) {
        result = await organizeSummary(item.id, { googleDocsUrl: item.documents.external_url })
      } else if (item.documents?.blobs?.storage_path) {
        const url = await getDownloadUrl(item.documents.blobs.storage_path)
        const res = await fetch(url)
        const blob = await res.blob()
        const filename = item.documents.original_filename || item.title
        const file = new File([blob], filename, { type: item.documents.blobs.mime })
        const text = await extractTextFromFile(file)
        if (!text) {
          setOrgError(t.topics.organizeErrorExtractFailed)
          return
        }
        result = await organizeSummary(item.id, { text })
      } else {
        return
      }
      if ('error' in result) setOrgError(mapOrganizeError(result.error))
      else setRefreshKey((k) => k + 1)
    } catch {
      setOrgError(t.topics.organizeErrorGeneric)
    } finally {
      setOrganizing(false)
    }
  }

  async function onDownload(item: SummaryWithFile) {
    const externalUrl = item.documents?.external_url
    if (externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer')
      return
    }
    const path = item.documents?.blobs?.storage_path
    if (!path) {
      setError(t.course.downloadError)
      return
    }
    try {
      const url = await getDownloadUrl(path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setError(t.course.downloadError)
    }
  }

  async function onTogglePublish(item: SummaryWithFile) {
    const nextStatus = item.status === 'published' ? 'draft' : 'published'
    await supabase.from('summaries').update({ status: nextStatus }).eq('id', item.id)
    await load()
  }

  async function onDelete(item: SummaryWithFile) {
    await supabase.from('summaries').delete().eq('id', item.id)
    await load()
  }

  const visible = (items ?? []).filter((s) => isAdmin || s.status === 'published')

  return (
    <div className="grid gap-6">
      <TopicsPanel courseId={courseId} refreshKey={refreshKey} />

      <div className="grid gap-4">
        <h2 className="font-display text-lg font-medium">{t.topics.rawDocuments}</h2>
        {isAdmin && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} disabled={busy} />
              <Button
                type="button"
                variant={linkMode ? 'quiet' : 'primary'}
                onClick={() => {
                  setLinkMode(false)
                  fileInputRef.current?.click()
                }}
                disabled={busy}
              >
                {busy && !linkMode ? t.course.uploading : t.course.addFromFile}
              </Button>
              <Button type="button" variant={linkMode ? 'primary' : 'quiet'} onClick={() => setLinkMode((v) => !v)} disabled={busy}>
                {t.course.addFromLink}
              </Button>
            </div>
            {linkMode && (
              <form onSubmit={onAddLink} className="flex flex-wrap items-center gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                  placeholder={t.course.linkTitlePlaceholder}
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  disabled={busy}
                />
                <input
                  className="min-w-0 flex-[2] rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                  placeholder={t.course.linkUrlPlaceholder}
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  disabled={busy}
                />
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy && linkMode ? t.course.linkAdding : t.course.linkAdd}
                </Button>
              </form>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}
        {(organizing || orgError) && (
          <p className={`text-sm ${orgError ? 'text-red-600' : 'text-muted'}`}>{orgError ?? t.topics.organizing}</p>
        )}
        {items === null ? (
          <div className="grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState title={t.course.emptySummaries} />
        ) : (
          <div className="grid gap-2">
            {visible.map((item) => (
              <Card key={item.id} className="document-row flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted">
                    {item.documents?.external_url ? 'Google Docs' : item.documents?.original_filename}
                    {item.documents?.blobs?.bytes ? (
                      <>
                        {' '}
                        · <Num>{formatBytes(item.documents.blobs.bytes)}</Num>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="document-actions flex flex-wrap items-center gap-2">
                  {isAdmin && (
                    <StatusChip tone={item.status === 'published' ? 'brand' : 'pending'}>
                      {item.status === 'published' ? t.course.statusPublished : t.course.statusDraft}
                    </StatusChip>
                  )}
                  <Button type="button" variant="quiet" onClick={() => onDownload(item)}>
                    {item.documents?.external_url ? t.course.open : t.course.download}
                  </Button>
                  {isAdmin && (
                    <>
                      <Button type="button" variant="quiet" onClick={() => onReorganize(item)} disabled={organizing}>
                        {t.topics.reorganize}
                      </Button>
                      <Button type="button" variant="quiet" onClick={() => onTogglePublish(item)}>
                        {item.status === 'published' ? t.course.unpublish : t.course.publish}
                      </Button>
                      <Button type="button" variant="quiet" onClick={() => onDelete(item)}>
                        {t.course.deleteFile}
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
