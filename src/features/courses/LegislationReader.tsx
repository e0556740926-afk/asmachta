import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Skeleton } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'
import { extractTextFromFile } from '../../lib/extractText'
import { fetchLegislationBrief, generateLegislationBrief } from '../../lib/legislation'
import { supabase, type CourseLegislationWithFile, type LegislationBriefRow } from '../../lib/supabase'
import { getDownloadUrl } from '../../lib/upload'

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

/** Reader view for one legislation item: an AI-organized brief (ordered heading+content parts, no
 * paragraph citations — deliberately simpler than rulings) alongside the full source text. Admins
 * can (re)generate the brief from the attached document. */
export function LegislationReader({
  item,
  isAdmin,
  onBack,
}: {
  item: CourseLegislationWithFile
  isAdmin: boolean
  onBack: () => void
}) {
  const legislation = item.legislation!
  const doc = legislation.documents
  const [brief, setBrief] = useState<LegislationBriefRow | null>(null)
  const [fullText, setFullText] = useState<string | null>(legislation.full_text)
  const [loaded, setLoaded] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [b, { data: row }] = await Promise.all([
      fetchLegislationBrief(legislation.id),
      supabase.from('legislation').select('full_text').eq('id', legislation.id).maybeSingle(),
    ])
    setBrief(b)
    setFullText((row as { full_text: string | null } | null)?.full_text ?? null)
    setLoaded(true)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legislation.id])

  async function onGenerate() {
    setGenerating(true)
    setError(null)
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
          setError(t.legislationReader.generateErrorExtractFailed)
          return
        }
        setFullText(text)
        result = await generateLegislationBrief(legislation.id, { text })
      } else {
        return
      }
      if ('error' in result) setError(mapGenerateError(result.error))
      else await load()
    } catch {
      setError(t.legislationReader.generateErrorGeneric)
    } finally {
      setGenerating(false)
    }
  }

  const briefParts = brief?.sections?.parts ?? []

  return (
    <div className="legislation-reader grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="text-sm text-brand hover:underline">
          {t.legislationReader.backToList}
        </button>
        {isAdmin && (
          <Button type="button" variant="quiet" onClick={onGenerate} disabled={generating}>
            {brief ? t.legislationReader.regenerateBrief : t.legislationReader.generateBrief}
          </Button>
        )}
      </div>

      <h2 className="font-display text-xl font-medium">{legislation.title}</h2>

      {(generating || error) && (
        <p className={`text-sm ${error ? 'text-red-600' : 'text-muted'}`}>{error ?? t.legislationReader.generating}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="grid content-start gap-4">
          <h3 className="text-sm font-medium">{t.legislationReader.aiBrief}</h3>
          {!loaded ? (
            <Skeleton className="h-24" />
          ) : briefParts.length === 0 ? (
            <EmptyState title={t.legislationReader.noBriefYet} />
          ) : (
            <div className="grid gap-4">
              {briefParts.map((part, i) => (
                <div key={i}>
                  <h3 className="font-medium">{part.heading}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{part.content}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="grid content-start gap-3">
          <h3 className="text-sm font-medium">{t.legislationReader.originalText}</h3>
          {!loaded ? (
            <Skeleton className="h-40" />
          ) : !fullText ? (
            <EmptyState title={t.legislationReader.noTextYet} />
          ) : (
            <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-ink">{fullText}</p>
          )}
        </Card>
      </div>
    </div>
  )
}
