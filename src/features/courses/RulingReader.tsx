import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Num, Skeleton, StatusChip } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'
import { extractTextFromFile } from '../../lib/extractText'
import { fetchRulingDetail, generateRulingBrief } from '../../lib/rulings'
import type { CourseRulingWithFile, RulingBriefRow, RulingParagraphRow } from '../../lib/supabase'
import { getDownloadUrl } from '../../lib/upload'

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

/** Reader view for a single ruling: an AI brief (parts + key points) whose citations jump to and
 * highlight specific numbered paragraphs in the full source text alongside it — matching the
 * original design's ruling() screen. Admins can (re)generate the brief from the attached document. */
export function RulingReader({
  item,
  isAdmin,
  onBack,
}: {
  item: CourseRulingWithFile
  isAdmin: boolean
  onBack: () => void
}) {
  const ruling = item.rulings!
  const doc = ruling.documents
  const [paragraphs, setParagraphs] = useState<RulingParagraphRow[] | null>(null)
  const [brief, setBrief] = useState<RulingBriefRow | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const paraRefs = useRef<Record<number, HTMLDivElement | null>>({})

  async function load() {
    const detail = await fetchRulingDetail(ruling.id)
    setParagraphs(detail.paragraphs)
    setBrief(detail.brief)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruling.id])

  function jumpTo(n: number) {
    setHighlighted(n)
    paraRefs.current[n]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => setHighlighted((h) => (h === n ? null : h)), 2500)
  }

  async function onGenerate() {
    setGenerating(true)
    setError(null)
    try {
      let result: Awaited<ReturnType<typeof generateRulingBrief>>
      if (doc?.external_url) {
        result = await generateRulingBrief(ruling.id, { googleDocsUrl: doc.external_url })
      } else if (doc?.blobs?.storage_path) {
        const url = await getDownloadUrl(doc.blobs.storage_path)
        const res = await fetch(url)
        const blob = await res.blob()
        const filename = doc.original_filename || ruling.title || 'ruling'
        const file = new File([blob], filename, { type: doc.blobs.mime })
        const text = await extractTextFromFile(file)
        if (!text) {
          setError(t.rulingReader.generateErrorExtractFailed)
          return
        }
        result = await generateRulingBrief(ruling.id, { text })
      } else {
        return
      }
      if ('error' in result) setError(mapGenerateError(result.error))
      else await load()
    } catch {
      setError(t.rulingReader.generateErrorGeneric)
    } finally {
      setGenerating(false)
    }
  }

  const briefParts = brief?.sections?.parts ?? []
  const keyPoints = brief?.sections?.keyPoints ?? []

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="text-sm text-brand hover:underline">
          {t.rulingReader.backToList}
        </button>
        {isAdmin && (
          <Button type="button" variant="quiet" onClick={onGenerate} disabled={generating}>
            {brief ? t.rulingReader.regenerateBrief : t.rulingReader.generateBrief}
          </Button>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          {ruling.case_type && (
            <StatusChip>
              {ruling.case_type}
              {ruling.case_number ? <> <Num>{ruling.case_number}</Num></> : null}
            </StatusChip>
          )}
          {ruling.court && <StatusChip tone="brand">{ruling.court}</StatusChip>}
        </div>
        <h2 className="mt-2 font-display text-xl font-medium">{ruling.title}</h2>
        {ruling.decision_date && (
          <p className="text-xs text-muted">
            <Num>{ruling.decision_date}</Num>
          </p>
        )}
      </div>

      {keyPoints.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-y border-line py-3">
          <span className="text-xs font-medium text-muted">{t.rulingReader.keyPoints}:</span>
          {keyPoints.map((kp, i) => (
            <button
              key={i}
              type="button"
              onClick={() => kp.paragraphNumbers?.[0] !== undefined && jumpTo(kp.paragraphNumbers[0])}
              className="rounded-full border border-line bg-soft px-3 py-1 text-xs hover:bg-tint"
            >
              {kp.label}
              {kp.paragraphNumbers?.length ? (
                <>
                  {' '}
                  <Num>¶{kp.paragraphNumbers.join(',')}</Num>
                </>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {(generating || error) && (
        <p className={`text-sm ${error ? 'text-red-600' : 'text-muted'}`}>{error ?? t.rulingReader.generating}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="grid content-start gap-4">
          <StatusChip tone="brand">✦ {t.rulingReader.aiBrief}</StatusChip>
          {paragraphs === null ? (
            <Skeleton className="h-24" />
          ) : briefParts.length === 0 ? (
            <EmptyState title={t.rulingReader.noBriefYet} />
          ) : (
            <div className="grid gap-4">
              {briefParts.map((part, i) => (
                <div key={i}>
                  <h3 className="font-medium">{part.heading}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{part.content}</p>
                  {part.paragraphNumbers?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {part.paragraphNumbers.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => jumpTo(n)}
                          className="rounded border border-line px-2 py-0.5 text-xs text-brand hover:bg-tint"
                        >
                          <Num>¶{n}</Num> ↗
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="grid content-start gap-3">
          <h3 className="text-sm font-medium">{t.rulingReader.originalText}</h3>
          {paragraphs === null ? (
            <Skeleton className="h-40" />
          ) : paragraphs.length === 0 ? (
            <EmptyState title={t.rulingReader.noParagraphsYet} />
          ) : (
            <div className="grid gap-3">
              {paragraphs.map((p) => (
                <div
                  key={p.id}
                  ref={(el) => {
                    paraRefs.current[p.n] = el
                  }}
                  className={`flex gap-3 rounded-md p-2 transition-colors ${highlighted === p.n ? 'bg-goldbg' : ''}`}
                >
                  <span className="shrink-0 text-xs text-muted">
                    <Num>{p.n}</Num>
                  </span>
                  <p className="text-sm text-ink">{p.text}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
