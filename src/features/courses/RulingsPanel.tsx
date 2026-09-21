import { useEffect, useRef, useState } from 'react'
import { supabase, type CourseRulingWithFile } from '../../lib/supabase'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Skeleton, Num } from '../../components/ui/Primitives'
import { addExternalDocument, getDownloadUrl, uploadDocument } from '../../lib/upload'
import { t } from '../../i18n/he'

function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Rulings & legislation tab: admin attaches a document (file or Google Docs link) to the course as
 * a `rulings` row (+ `course_rulings` join); members browse/open it. Deliberately skips the rich
 * case-metadata / AI-brief / citation-graph machinery the schema already anticipates (case_number,
 * court, judges, brief_status, …) — this is a functional M1 pass, not the full ruling pipeline.
 */
export function RulingsPanel({ courseId }: { courseId: string }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [items, setItems] = useState<CourseRulingWithFile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkMode, setLinkMode] = useState(false)
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [fileTitle, setFileTitle] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function load() {
    const { data } = await supabase
      .from('course_rulings')
      .select('*, rulings(*, documents(*, blobs(*)))')
      .eq('course_id', courseId)
    const rows = ((data as CourseRulingWithFile[] | null) ?? []).slice()
    rows.sort((a, b) => (b.rulings?.created_at ?? '').localeCompare(a.rulings?.created_at ?? ''))
    setItems(rows)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  async function attachToCourse(documentId: string, title: string) {
    const { data: ruling, error: rulingError } = await supabase
      .from('rulings')
      .insert({ title, document_id: documentId })
      .select('id')
      .single()
    if (rulingError) throw rulingError
    const { error: linkError } = await supabase
      .from('course_rulings')
      .insert({ course_id: courseId, ruling_id: (ruling as { id: string }).id })
    if (linkError) throw linkError
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile) return
    setBusy(true)
    setError(null)
    try {
      const { documentId } = await uploadDocument(file, { kind: 'ruling', ownerId: profile.id, visibility: 'core' })
      const title = fileTitle.trim() || file.name.replace(/\.[^./]+$/, '')
      await attachToCourse(documentId, title)
      setFileTitle('')
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
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
    try {
      const { documentId } = await addExternalDocument(linkUrl, { kind: 'ruling', ownerId: profile.id, visibility: 'core' })
      await attachToCourse(documentId, linkTitle.trim())
      setLinkTitle('')
      setLinkUrl('')
      setLinkMode(false)
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
    }
  }

  async function onOpen(item: CourseRulingWithFile) {
    const doc = item.rulings?.documents
    if (doc?.external_url) {
      window.open(doc.external_url, '_blank', 'noopener,noreferrer')
      return
    }
    const path = doc?.blobs?.storage_path
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

  async function onDelete(item: CourseRulingWithFile) {
    if (!item.ruling_id) return
    await supabase.from('rulings').delete().eq('id', item.ruling_id)
    await load()
  }

  return (
    <div className="grid gap-4">
      {isAdmin && (
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} disabled={busy} />
            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
              placeholder={t.course.linkTitlePlaceholder}
              value={linkMode ? linkTitle : fileTitle}
              onChange={(e) => (linkMode ? setLinkTitle(e.target.value) : setFileTitle(e.target.value))}
              disabled={busy}
            />
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
      {items === null ? (
        <div className="grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t.course.emptyRulings} />
      ) : (
        <div className="grid gap-2">
          {items.map((item) => {
            const doc = item.rulings?.documents
            return (
              <Card key={item.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.rulings?.title}</p>
                  <p className="truncate text-xs text-muted">
                    {doc?.external_url ? 'Google Docs' : doc?.original_filename}
                    {doc?.blobs?.bytes ? (
                      <>
                        {' '}
                        · <Num>{formatBytes(doc.blobs.bytes)}</Num>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button type="button" variant="quiet" onClick={() => onOpen(item)}>
                    {doc?.external_url ? t.course.open : t.course.download}
                  </Button>
                  {isAdmin && (
                    <Button type="button" variant="quiet" onClick={() => onDelete(item)}>
                      {t.course.deleteFile}
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
