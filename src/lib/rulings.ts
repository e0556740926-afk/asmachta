import { supabase, type RulingBriefRow, type RulingParagraphRow } from './supabase'

export type ManualRulingSegment = { heading?: string; content: string }

/** Fetches a ruling's numbered source paragraphs (ordered) and its current AI brief, if any. */
export async function fetchRulingDetail(
  rulingId: string
): Promise<{ paragraphs: RulingParagraphRow[]; brief: RulingBriefRow | null }> {
  const [{ data: paragraphs, error: pError }, { data: briefs, error: bError }] = await Promise.all([
    supabase.from('ruling_paragraphs').select('*').eq('ruling_id', rulingId).order('seq', { ascending: true }),
    supabase.from('ruling_briefs').select('*').eq('ruling_id', rulingId).order('created_at', { ascending: false }).limit(1),
  ])
  if (pError) throw pError
  if (bError) throw bError
  return {
    paragraphs: (paragraphs as RulingParagraphRow[] | null) ?? [],
    brief: ((briefs as RulingBriefRow[] | null) ?? [])[0] ?? null,
  }
}

/** Kicks off numbered-paragraph extraction + AI brief generation for a ruling. `text` is used for
 * an uploaded file (already extracted client-side); `googleDocsUrl` for a Google Docs link (the
 * function fetches it server-side). Replaces any existing paragraphs/brief for this ruling. */
export async function generateRulingBrief(
  rulingId: string,
  source: { text: string } | { googleDocsUrl: string }
): Promise<{ paragraphCount: number; partsCount: number } | { error: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('generate-ruling-brief', {
    body: { rulingId, ...source },
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  })
  if (error) {
    const context = (error as { context?: Response }).context
    const code = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null
    return { error: (code as { error?: string } | null)?.error ?? 'upstream_error' }
  }
  return data as { paragraphCount: number; partsCount: number }
}

// ------------------------------------------------------------
// Manual processing bypass — same idea as Summaries' (lib/topics.ts): when the built-in Gemini
// call keeps failing/queuing, generate a *simple* prompt (no paragraph-citation task — that's the
// part of generate-ruling-brief's schema that's failure-prone and hard to reproduce by hand), let
// the admin run it through any AI chat themselves, and upload the JSON result. The full text is
// still split into numbered paragraphs for the reader's source-text pane, but deterministically
// here on the client (no AI needed for that part) — so the brief parts just don't carry any
// paragraphNumbers, and the reader already renders that gracefully (no jump buttons shown).
// ------------------------------------------------------------

/** Builds a simple prompt (headings + content only) for pasting into any AI chat by hand. */
export function buildManualRulingPrompt(rulingTitle: string, text: string): string {
  return [
    `אתם עוזרי לימוד שמכינים תמצית לימודית לפסק דין ("${rulingTitle}") לקריאה על ידי סטודנטים למשפטים בישראל.`,
    `להלן טקסט פסק הדין. כתבו תמצית לימודית בעברית, מחולקת לחלקים סדורים (כמו: "מה עומד במרכז פסק הדין", "השאלה המשפטית", "העיקרון ללמידה") — לכל חלק תנו כותרת קצרה ותוכן של פסקה-שתיים.`,
    ``,
    `חשוב מאוד לגבי הפלט: החזירו אך ורק מערך JSON תקין בפורמט הזה, ללא כל טקסט נוסף לפניו או אחריו, וללא markdown code fences (בלי \`\`\`):`,
    `[{"heading": "...", "content": "..."}, ...]`,
    ``,
    `הטקסט:`,
    '"""',
    text,
    '"""',
  ].join('\n')
}

/** Validates and normalizes a parsed JSON value into ManualRulingSegment[]. */
export function parseManualRulingSegments(parsed: unknown): ManualRulingSegment[] {
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not_an_array')
  return parsed.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`item_${i}_not_object`)
    const obj = item as Record<string, unknown>
    if (typeof obj.content !== 'string' || !obj.content.trim()) throw new Error(`item_${i}_missing_content`)
    return {
      content: obj.content,
      heading: typeof obj.heading === 'string' ? obj.heading : undefined,
    }
  })
}

/** Deterministically splits text into numbered paragraphs — the same shape generate-ruling-brief
 * would ask Gemini for, just done locally: split on blank lines first, and if that yields only one
 * paragraph (no blank-line breaks in the source), fall back to splitting on single newlines. */
export function splitIntoParagraphs(text: string): string[] {
  const byBlankLine = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (byBlankLine.length > 1) return byBlankLine
  return text
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Writes a manually-processed ruling straight into ruling_paragraphs (numbered deterministically
 * from the full text) + ruling_briefs (the hand-organized parts, with no paragraph citations). */
export async function applyManualRulingSegments(
  rulingId: string,
  fullText: string,
  segments: ManualRulingSegment[]
): Promise<{ paragraphCount: number; partsCount: number }> {
  const paragraphs = splitIntoParagraphs(fullText)

  await supabase.from('ruling_paragraphs').delete().eq('ruling_id', rulingId)
  if (paragraphs.length > 0) {
    const rows = paragraphs.map((text, i) => ({ ruling_id: rulingId, n: i + 1, seq: i, text }))
    const { error: paraError } = await supabase.from('ruling_paragraphs').insert(rows)
    if (paraError) throw paraError
  }

  await supabase.from('ruling_briefs').delete().eq('ruling_id', rulingId)
  const { error: briefError } = await supabase.from('ruling_briefs').insert({
    ruling_id: rulingId,
    sections: {
      parts: segments.map((s) => ({ heading: s.heading ?? '', content: s.content, paragraphNumbers: [] })),
      keyPoints: [],
    },
  })
  if (briefError) throw briefError

  await supabase.from('rulings').update({ brief_status: 'ai' }).eq('id', rulingId)

  return { paragraphCount: paragraphs.length, partsCount: segments.length }
}
