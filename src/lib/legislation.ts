import { supabase, type LegislationBriefRow } from './supabase'

/** Fetches a legislation item's current AI brief (if any) — the full source text lives directly
 * on the `legislation` row itself (no separate paragraphs table; see migration 0007). */
export async function fetchLegislationBrief(legislationId: string): Promise<LegislationBriefRow | null> {
  const { data, error } = await supabase
    .from('legislation_briefs')
    .select('*')
    .eq('legislation_id', legislationId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return ((data as LegislationBriefRow[] | null) ?? [])[0] ?? null
}

/** Kicks off AI brief generation for a legislation item. `text` is used for an uploaded file
 * (already extracted client-side); `googleDocsUrl` for a Google Docs link (the function fetches it
 * server-side). Replaces any existing brief and saves the full text on the legislation row. */
export async function generateLegislationBrief(
  legislationId: string,
  source: { text: string } | { googleDocsUrl: string }
): Promise<{ partsCount: number } | { error: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('generate-legislation-brief', {
    body: { legislationId, ...source },
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  })
  if (error) {
    const context = (error as { context?: Response }).context
    const code = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null
    return { error: (code as { error?: string } | null)?.error ?? 'upstream_error' }
  }
  return data as { partsCount: number }
}

// ------------------------------------------------------------
// Manual processing bypass — same simple shape as the automatic path (see generate-legislation-
// brief): no paragraph citations at all, so there's nothing deterministic to compute locally the
// way rulings' manual bypass splits paragraphs — this just saves the full text + the hand-organized
// parts straight through.
// ------------------------------------------------------------

export type ManualLegislationSegment = { heading?: string; content: string }

/** Builds a simple prompt (headings + content only) for pasting into any AI chat by hand. */
export function buildManualLegislationPrompt(title: string, text: string): string {
  return [
    `אתם עוזרי לימוד שמארגנים טקסט חקיקה ("${title}") לקריאה על ידי סטודנטים למשפטים בישראל.`,
    `להלן הטקסט. חלקו אותו לחלקים סדורים לפי סעיפים/נושאים (למשל כל סעיף או קבוצת סעיפים קשורים כחלק נפרד). לכל חלק תנו כותרת קצרה וברורה (למשל מספר הסעיף ונושאו) ותוכן — נוסח הטקסט המקורי של אותו חלק, בלי לקצר או להמציא תוכן.`,
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

/** Validates and normalizes a parsed JSON value into ManualLegislationSegment[]. */
export function parseManualLegislationSegments(parsed: unknown): ManualLegislationSegment[] {
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

/** Writes a manually-processed legislation item's full text + hand-organized brief. */
export async function applyManualLegislationSegments(
  legislationId: string,
  fullText: string,
  segments: ManualLegislationSegment[]
): Promise<{ partsCount: number }> {
  await supabase.from('legislation').update({ full_text: fullText, brief_status: 'ai' }).eq('id', legislationId)

  await supabase.from('legislation_briefs').delete().eq('legislation_id', legislationId)
  const { error: briefError } = await supabase.from('legislation_briefs').insert({
    legislation_id: legislationId,
    sections: { parts: segments.map((s) => ({ heading: s.heading ?? '', content: s.content })) },
  })
  if (briefError) throw briefError

  return { partsCount: segments.length }
}
