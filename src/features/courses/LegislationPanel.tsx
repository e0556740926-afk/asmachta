import { useEffect, useRef, useState } from 'react'
import { supabase, type CourseLegislationWithFile } from '../../lib/supabase'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Skeleton, Num } from '../../components/ui/Primitives'
import { addExternalDocument, getDownloadUrl, uploadDocument } from '../../lib/upload'
import { extractTextFromFile } from '../../lib/extractText'
import {
  applyManualLegislationSegments,
  buildManualLegislationPrompt,
  generateLegislationBrief,
  parseManualLegislationSegments,
} from '../../lib/legislation'
import { LegislationReader } from './LegislationReader'
import { t } from '../../i18n/he'

function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function mapGenerateError(code: string): string {
  switch (code) {
    case 'upstream_busy':
      return t.legislationReader.generateErrorBusy
    case 'google_doc_not_accessible':
      return t.legislationReader.generateErrorGoogleDoc
    case 'empty_text':
      return t.legislationReader.generateErrorExtractFailed
    default:
      return t.legislationReader.generateErrorGeneric
  }
}

/**
 * Legislation tab: admin attaches a document (file or Google Docs link) to the course as a
 * `legislation` row (+ `course_legislation` join). A simple AI brief (ordered heading+content
 * parts, no paragraph citations — see migration 0007) is generated automatically; clicking an item
 * opens a reader with the brief and full source text.
 */
export function LegislationPanel({ courseId }: { courseId: string }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [items, setItems] = useState<CourseLegislationWithFile[] | null>(null)
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

  const [manualOpenId, setManualOpenId] = useState<string | null>(null)
  const [manualPrompt, setManualPrompt] = useState('')
  const manualTextRef = useRef('')
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualCopied, setManualCopied] = useState(false)
  const [manualResult, setManualResult] = useState<{ partsCount: number } | null>(null)

  async function load() {
    const { data } = await supabase
      .from('course_legislation')
      .select('*, legislation(*, documents(*, blobs(*)))')
      .eq('course_id', courseId)
    const rows = ((data as CourseLegislationWithFile[] | null) ?? []).slice()
    rows.sort((a, b) => (b.legislation?.created_at ?? '').localeCompare(a.legislation?.created_at ?? ''))
    setItems(rows)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  async function attachToCourse(documentId: string, title: string): Promise<string> {
    const { data: item, error: itemError } = await supabase
      .from('legislation')
      .insert({ title, document_id: documentId })
      .select('id')
      .single()
    if (itemError) throw itemError
    const legislationId = (item as { id: string }).id
    const { error: linkError } = await supabase.from('course_legislation').insert({ course_id: courseId, legislation_id: legislationId })
    if (linkError) throw linkError
    return legislationId
  }

  async function runGenerate(legislationId: string, source: { text: string } | { googleDocsUrl: string }) {
    setGenerating(true)
    setGenError(null)
    try {
      const result = await generateLegislationBrief(legislationId, source)
      if ('error' in result) setGenError(mapGenerateError(result.error))
      else await load()
    } catch {
      setGenError(t.legislationReader.generateErrorGeneric)
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
    let legislationId: string | null = null
    try {
      const { documentId } = await uploadDocument(file, { kind: 'law', ownerId: profile.id, visibility: 'core' })
      const title = fileTitle.trim() || file.name.replace(/\.[^./]+$/, '')
      legislationId = await attachToCourse(documentId, title)
      setFileTitle('')
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
    }

    if (legislationId) {
      const text = await extractTextFromFile(file)
      if (!text) setGenError(t.legislationReader.generateErrorExtractFailed)
      else await runGenerate(legislationId, { text })
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
    let legislationId: string | null = null
    const urlForGenerate = linkUrl.trim()
    try {
      const { documentId } = await addExternalDocument(linkUrl, { kind: 'law', ownerId: profile.id, visibility: 'core' })
      legislationId = await attachToCourse(documentId, linkTitle.trim())
      setLinkTitle('')
      setLinkUrl('')
      setLinkMode(false)
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
    }

    if (legislationId) await runGenerate(legislationId, { googleDocsUrl: urlForGenerate })
  }

  async function onReorganize(item: CourseLegislationWithFile) {
    const legislation = item.legislation
    const doc = legislation?.documents
    if (!legislation) return
    setGenerating(true)
    setGenError(null)
    try {
      let result: Awaited<ReturnType<typeof generateLegislationBrief>>
      if (doc?.external_url) {
        result = await generateLegislationBrief(legislation.id, { googleDocsUrl: doc.external_url })
      } else if (doc?.blobs?.storage_path) {
        const url = await getDownloadUrl(doc.blobs.storage_path)
        const res = await fetch(url)
        const blob = await res.blob()
        const filename = doc.original_filename || legislation.title || 'legislation'
        const file = new File([blob], filename, { type: doc.blobs.mime })
        const text = await extractTextFromFile(file)
        if (!text) {
          setGenError(t.legislationReader.generateErrorExtractFailed)
          return
        }
        result = await generateLegislationBrief(legislation.id, { text })
      } else {
        return
      }
      if ('error' in result) setGenError(mapGenerateError(result.error))
      else await load()
    } catch {
      setGenError(t.legislationReader.generateErrorGeneric)
    } finally {
      setGenerating(false)
    }
  }

  function closeManual() {
    setManualOpenId(null)
    setManualPrompt('')
    manualTextRef.current = ''
    setManualError(null)
    setManualResult(null)
    setManualCopied(false)
  }

  async function onOpenManual(item: CourseLegislationWithFile) {
    const legislation = item.legislation
    const doc = legislation?.documents
    if (!legislation) return
    setManualOpenId(item.id)
    setManualBusy(true)
    setManualError(null)
    setManualResult(null)
    setManualCopied(false)
    setManualPrompt('')
    manualTextRef.current = ''
    try {
      let text: string | null = null
      if (doc?.external_url) {
        const docId = doc.external_url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)?.[1]
        if (docId) {
          const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`)
          if (res.ok) text = await res.text()
        }
      } else if (doc?.blobs?.storage_path) {
        const url = await getDownloadUrl(doc.blobs.storage_path)
        const res = await fetch(url)
        const blob = await res.blob()
        const filename = doc.original_filename || legislation.title || 'legislation'
        const file = new File([blob], filename, { type: doc.blobs.mime })
        text = await extractTextFromFile(file)
      }
      if (!text || !text.trim()) {
        setManualError(t.legislationReader.generateErrorExtractFailed)
        return
      }
      manualTextRef.current = text.trim()
      setManualPrompt(buildManualLegislationPrompt(legislation.title ?? '', text.trim()))
    } catch {
      setManualError(t.legislationReader.generateErrorGeneric)
    } finally {
      setManualBusy(false)
    }
  }

  async function onCopyManualPrompt() {
    try {
      await navigator.clipboard.writeText(manualPrompt)
      setManualCopied(true)
      window.setTimeout(() => setManualCopied(false), 2000)
    } catch {
      // Clipboard access can be blocked — the prompt is also shown in a selectable textarea below.
    }
  }

  async function onManualFilePicked(item: CourseLegislationWithFile, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !item.legislation_id) return
    setManualBusy(true)
    setManualError(null)
    setManualResult(null)
    try {
      const raw = await file.text()
      let segments: ReturnType<typeof parseManualLegislationSegments>
      try {
        segments = parseManualLegislationSegments(JSON.parse(raw))
      } catch {
        setManualError(t.topics.manualParseError)
        return
      }
      try {
        const result = await applyManualLegislationSegments(item.legislation_id, manualTextRef.current, segments)
        setManualResult(result)
        await load()
      } catch {
        setManualError(t.topics.manualApplyError)
      }
    } finally {
      setManualBusy(false)
    }
  }

  async function onOpen(item: CourseLegislationWithFile) {
    const doc = item.legislation?.documents
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

  async function onDelete(item: CourseLegislationWithFile) {
    if (!item.legislation_id) return
    await supabase.from('legislation').delete().eq('id', item.legislation_id)
    if (openItemId === item.id) setOpenItemId(null)
    await load()
  }

  const openItem = items?.find((it) => it.id === openItemId) ?? null

  if (openItem) {
    return <LegislationReader item={openItem} isAdmin={isAdmin} onBack={() => setOpenItemId(null)} />
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
        <p className={`text-sm ${genError ? 'text-red-600' : 'text-muted'}`}>{genError ?? t.legislationReader.generating}</p>
      )}
      {items === null ? (
        <div className="grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t.course.emptyLegislation} />
      ) : (
        <div className="grid gap-2">
          {items.map((item) => {
            const doc = item.legislation?.documents
            return (
              <div key={item.id} className="grid gap-2">
                <Card className="flex items-center justify-between gap-3 p-4">
                  <button type="button" onClick={() => setOpenItemId(item.id)} className="min-w-0 flex-1 text-start">
                    <p className="truncate font-medium hover:underline">{item.legislation?.title}</p>
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
                      <>
                        <Button type="button" variant="quiet" onClick={() => onReorganize(item)} disabled={generating}>
                          {t.legislationReader.regenerateBrief}
                        </Button>
                        <Button
                          type="button"
                          variant="quiet"
                          onClick={() => (manualOpenId === item.id ? closeManual() : onOpenManual(item))}
                        >
                          {t.legislationReader.manualProcess}
                        </Button>
                        <Button type="button" variant="quiet" onClick={() => onDelete(item)}>
                          {t.course.deleteFile}
                        </Button>
                      </>
                    )}
                  </div>
                </Card>

                {manualOpenId === item.id && (
                  <Card className="grid gap-3 p-4">
                    <p className="text-sm text-muted">{t.legislationReader.manualIntro}</p>
                    {manualBusy && !manualPrompt && <p className="text-sm text-muted">{t.topics.manualExtracting}</p>}
                    {manualPrompt && (
                      <>
                        <textarea readOnly value={manualPrompt} className="h-40 rounded-md border border-line bg-bg px-3 py-2 text-xs text-ink" />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" variant="quiet" onClick={onCopyManualPrompt}>
                            {manualCopied ? t.topics.manualCopied : t.topics.manualCopyPrompt}
                          </Button>
                          <label className="flex items-center gap-2 text-sm">
                            <span>{t.topics.manualUploadLabel}</span>
                            <input
                              type="file"
                              accept=".json,application/json"
                              disabled={manualBusy}
                              onChange={(e) => onManualFilePicked(item, e)}
                            />
                          </label>
                        </div>
                      </>
                    )}
                    {manualError && <p className="text-sm text-red-600">{manualError}</p>}
                    {manualResult && (
                      <p className="text-sm text-brand">
                        {t.topics.manualSuccess}: <Num>{manualResult.partsCount}</Num> {t.legislationReader.manualPartsCount}
                      </p>
                    )}
                    <Button type="button" variant="quiet" onClick={closeManual} className="justify-self-start">
                      {t.topics.manualClose}
                    </Button>
                  </Card>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
