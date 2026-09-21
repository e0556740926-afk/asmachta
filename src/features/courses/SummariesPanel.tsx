import { useEffect, useRef, useState } from 'react'
import { supabase, type SummaryWithFile } from '../../lib/supabase'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, StatusChip, Skeleton, Num } from '../../components/ui/Primitives'
import { getDownloadUrl, uploadDocument } from '../../lib/upload'
import { t } from '../../i18n/he'

function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function SummariesPanel({ courseId }: { courseId: string }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [items, setItems] = useState<SummaryWithFile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    try {
      const { documentId } = await uploadDocument(file, { kind: 'summary', ownerId: profile.id, visibility: 'core' })
      const title = file.name.replace(/\.[^./]+$/, '')
      const { error: insertError } = await supabase
        .from('summaries')
        .insert({ course_id: courseId, document_id: documentId, title, status: 'published' })
      if (insertError) throw insertError
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
    }
  }

  async function onDownload(item: SummaryWithFile) {
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
    <div className="grid gap-4">
      {isAdmin && (
        <div className="flex items-center gap-3">
          <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} disabled={busy} />
          <Button type="button" variant="primary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? t.course.uploading : t.course.upload}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
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
            <Card key={item.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.title}</p>
                <p className="truncate text-xs text-muted">
                  {item.documents?.original_filename} · <Num>{formatBytes(item.documents?.blobs?.bytes)}</Num>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isAdmin && (
                  <StatusChip tone={item.status === 'published' ? 'brand' : 'pending'}>
                    {item.status === 'published' ? t.course.statusPublished : t.course.statusDraft}
                  </StatusChip>
                )}
                <Button type="button" variant="quiet" onClick={() => onDownload(item)}>
                  {t.course.download}
                </Button>
                {isAdmin && (
                  <>
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
  )
}
