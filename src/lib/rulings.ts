import { supabase, type RulingBriefRow, type RulingParagraphRow } from './supabase'

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
