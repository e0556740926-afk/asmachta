import { useEffect, useRef, useState } from 'react'
import { supabase, type CourseRulingWithFile } from '../../lib/supabase'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Skeleton, Num } from '../../components/ui/Primitives'
import { addExternalDocument, getDownloadUrl, uploadDocument } from '../../lib/upload'
import { extractTextFromFile } from '../../lib/extractText'
import { generateRulingBrief } from '../../lib/rulings'
import { RulingReader } from './RulingReader'
import { t } from '../../i18n/he'

function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function mapGenerateError(code: string): string {
  switch (code) {
    case 'upstream_busy':
      return t.rulingReader.generateErrorBusy
    case 'google_doc_not_accessible':
      return t.rulingReader.generateErrorGoogleDoc
    case 'empty_text':
      return t.rulingReader.generateErrorExtractFailed
    default:
      return t.rulingReader.generateErrorGeneric
  }
}

/**
 * Rulings & legislation tab: admin attaches a document (file or Google Docs link) to the course as
 * a `rulings` row (+ `course_rulings` join). Every attached ruling is automatically split into
 * numbered, citable paragraphs with an AI brief (ruling_paragraphs / ruling_briefs, wired up here
 * for the first time); clicking a ruling opens a reader with the brief and source text side by side.
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

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [openItemId, setOpenItemId] = useState<string | null>(null)

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

  async function attachToCourse(documentId: string, title: string): Promise<string> {
    const { data: ruling, error: rulingError } = await supabase
      .from('rulings')
      .insert({ title, document_id: documentId })
      .select('id')
      .single()
    if (rulingError) throw rulingError
    const rulingId = (ruling as { id: string }).id
    const { error: linkError } = await supabase.from('course_rulings').insert({ course_id: courseId, ruling_id: rulingId })
    if (linkError) throw linkError
    return rulingId
  }

  async function runGenerate(rulingId: string, source: { text: string } | { googleDocsUrl: string }) {
    setGenerating(true)
    setGenError(null)
    try {
      const result = await generateRulingBrief(rulingId, source)
      if ('error' in result) setGenError(mapGenerateError(result.error))
      else await load()
    } catch {
      setGenError(t.rulingReader.generateErrorGeneric)
    } finally {
      setGenerating(false)
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile) return
    setBusy(true)
    setError(null)
    setGenError(null)
    let rulingId: string | null = null
    try {
      const { documentId } = await uploadDocument(file, { kind: 'ruling', ownerId: profile.id, visibility: 'core' })
      const title = fileTitle.trim() || file.name.replace(/\.[^./]+$/, '')
      rulingId = await attachToCourse(documentId, title)
      setFileTitle('')
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
    }

    if (rulingId) {
      const text = await extractTextFromFile(file)
      if (!text) setGenError(t.rulingReader.generateErrorExtractFailed)
      else await runGenerate(rulingId, { text })
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
    setGenError(null)
    let rulingId: string | null = null
    const urlForGenerate = linkUrl.trim()
    try {
      const { documentId } = await addExternalDocument(linkUrl, { kind: 'ruling', ownerId: profile.id, visibility: 'core' })
      rulingId = await attachToCourse(documentId, linkTitle.trim())
      setLinkTitle('')
      setLinkUrl('')
      setLinkMode(false)
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
    }

    if (rulingId) await runGenerate(rulingId, { googleDocsUrl: urlForGenerate })
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
    if (openItemId === item.id) setOpenItemId(null)
    await load()
  }

  const openItem = items?.find((it) => it.id === openItemId) ?? null

  if (openItem) {
    return <RulingReader item={openItem} isAdmin={isAdmin} onBack={() => setOpenItemId(null)} />
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
      {(generating || genError) && (
        <p className={`text-sm ${genError ? 'text-red-600' : 'text-muted'}`}>{genError ?? t.rulingReader.generating}</p>
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
                <button
                  type="button"
                  onClick={() => setOpenItemId(item.id)}
                  className="min-w-0 flex-1 text-start"
                >
                  <p className="truncate font-medium hover:underline">{item.rulings?.title}</p>
                  <p className="truncate text-xs text-muted">
                    {doc?.external_url ? 'Google Docs' : doc?.original_filename}
                    {doc?.blobs?.bytes ? (
                      <>
                        {' '}
                        · <Num>{formatBytes(doc.blobs.bytes)}</Num>
                      </>
                    ) : null}
                  </p>
                </button>
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
