import { supabase, type TopicSectionRow, type TopicWithSections } from './supabase'

export async function fetchTopics(courseId: string): Promise<TopicWithSections[]> {
  const { data, error } = await supabase
    .from('topics')
    .select('*, topic_sections(*)')
    .eq('course_id', courseId)
    .is('parent_id', null)
    .order('position', { ascending: true })
  if (error) throw error
  const rows = (data as TopicWithSections[]) ?? []
  for (const t of rows) t.topic_sections.sort((a, b) => a.position - b.position)
  return rows
}

/** Kicks off text extraction + AI topic organization for a summary that was just created (or, for
 * the backfill, an older one). `text` is used for an uploaded file (already extracted client-side);
 * `googleDocsUrl` is used for a Google Docs link summary (the function fetches it server-side). */
export async function organizeSummary(
  summaryId: string,
  source: { text: string } | { googleDocsUrl: string }
): Promise<{ topicsCreated: number; sectionsCreated: number } | { error: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('organize-summary', {
    body: { summaryId, ...source },
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  })
  if (error) {
    const context = (error as { context?: Response }).context
    const code = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null
    return { error: (code as { error?: string } | null)?.error ?? 'upstream_error' }
  }
  return data as { topicsCreated: number; sectionsCreated: number }
}

// ------------------------------------------------------------
// Manual editing — admin can add/edit topics and sections directly, without an upload.
// ------------------------------------------------------------

export async function createTopic(courseId: string, title: string, position: number): Promise<string> {
  const { data, error } = await supabase.from('topics').insert({ course_id: courseId, title, position }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function updateTopicTitle(topicId: string, title: string): Promise<void> {
  const { error } = await supabase.from('topics').update({ title }).eq('id', topicId)
  if (error) throw error
}

export async function deleteTopic(topicId: string): Promise<void> {
  const { error } = await supabase.from('topics').delete().eq('id', topicId)
  if (error) throw error
}

/** Adds a manually-written section to a topic. Needs a `summary_id` to attach to (the schema
 * requires one for provenance) — the caller passes the course's most recent summary, or creates a
 * lightweight "manual entry" summary row the first time a course has none yet. */
export async function addManualSection(
  topicId: string,
  summaryId: string,
  position: number,
  heading: string,
  html: string
): Promise<void> {
  const { error } = await supabase.from('topic_sections').insert({
    topic_id: topicId,
    summary_id: summaryId,
    position,
    heading,
    html,
    ai_reason: null,
  })
  if (error) throw error
}

export async function updateSection(sectionId: string, heading: string, html: string): Promise<void> {
  const { error } = await supabase.from('topic_sections').update({ heading, html }).eq('id', sectionId)
  if (error) throw error
}

export async function deleteSection(sectionId: string): Promise<void> {
  const { error } = await supabase.from('topic_sections').delete().eq('id', sectionId)
  if (error) throw error
}

/** Ensures the course has at least one `summaries` row to attach manually-written sections to
 * (the schema ties every topic_section to a summary for provenance) — creates a lightweight
 * "manual entries" one the first time it's needed. */
export async function ensureManualSummary(courseId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('summaries')
    .select('id')
    .eq('course_id', courseId)
    .eq('title', '__manual__')
    .maybeSingle()
  if (existing) return (existing as { id: string }).id
  const { data, error } = await supabase
    .from('summaries')
    .insert({ course_id: courseId, title: '__manual__', status: 'published' })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/** Marks a topic as opened by this user, for the home page's "continue where you left off" card.
 * Upserts on the (user_id, target_type, target_id) primary key so repeated opens just bump
 * `updated_at`. Best-effort — a failure here shouldn't block reading the topic. */
export async function recordTopicProgress(userId: string, topicId: string): Promise<void> {
  await supabase
    .from('reading_progress')
    .upsert(
      { user_id: userId, target_type: 'topic', target_id: topicId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,target_type,target_id' }
    )
}

export type { TopicSectionRow }
