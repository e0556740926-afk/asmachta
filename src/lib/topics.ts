import { supabase, type TopicSectionRow, type TopicWithSections } from './supabase'

export type ManualSegment = { topic: string; heading?: string; content: string; reason?: string }

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
// Manual processing bypass — when the built-in Gemini call keeps failing/queuing, generate the same
// prompt organize-summary would send, let the admin run it through any AI chat themselves, and
// upload the JSON result directly (mirrors organize-summary's own prompt + response schema, and its
// find-or-create-by-title matching, so the outcome is the same either way).
// ------------------------------------------------------------

/** Builds the exact prompt organize-summary's edge function would send to Gemini, for pasting into
 * any AI chat by hand. `existingTopics` should be this course's current topic titles, so the result
 * reuses them instead of creating near-duplicates. */
export function buildManualOrganizePrompt(courseTitle: string, existingTopics: string[], text: string): string {
  const existingTopicsBlock = existingTopics.length > 0 ? existingTopics.map((t) => `- ${t}`).join('\n') : '(אין נושאים קיימים עדיין בקורס הזה)'
  return [
    `אתם עוזרי לימוד שמארגנים סיכום לימודי של הקורס "${courseTitle}" (פקולטה למשפטים בישראל) לפי נושאים.`,
    `להלן טקסט שחולץ ממסמך סיכום. חלקו אותו למקטעים לפי נושא משפטי.`,
    ``,
    `הנושאים הקיימים כרגע בקורס הזה:`,
    existingTopicsBlock,
    ``,
    `לכל מקטע החזירו אובייקט עם:`,
    `- topic: שם הנושא. אם המקטע שייך לאחד הנושאים הקיימים שלמעלה, השתמשו בדיוק באותו שם (מילה במילה, כולל ניקוד/רווחים). אחרת הציעו שם נושא חדש קצר וברור (2-5 מילים).`,
    `- heading: כותרת קצרה למקטע הספציפי הזה בתוך הנושא (למשל תת-סעיף).`,
    `- content: תוכן המקטע — טקסט מלא ושמיש, ניתן לעריכה מאוחר יותר.`,
    `- reason: משפט אחד קצר שמסביר למה המקטע הזה שויך לנושא הזה.`,
    ``,
    `חשוב: שמרו על כל תוכן הטקסט המקורי (אל תמציאו תוכן, אל תקצרו יתר על המידה, ואל תשמיטו חלקים) — רק ארגנו אותו מחדש לפי נושאים. אפשר לפצל נושא אחד למספר מקטעים אם יש בו כמה תתי-נושאים ברורים.`,
    ``,
    `חשוב מאוד לגבי הפלט: החזירו אך ורק מערך JSON תקין בפורמט הזה, ללא כל טקסט נוסף לפניו או אחריו, וללא markdown code fences (בלי \`\`\`):`,
    `[{"topic": "...", "heading": "...", "content": "...", "reason": "..."}, ...]`,
    ``,
    `הטקסט:`,
    '"""',
    text,
    '"""',
  ].join('\n')
}

/** Validates and normalizes a parsed JSON value into ManualSegment[] — the shape a hand-run AI chat
 * should have produced from the prompt above. Throws with a human-readable reason on the first
 * problem found, so the caller can show it directly. */
export function parseManualSegments(parsed: unknown): ManualSegment[] {
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not_an_array')
  return parsed.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`item_${i}_not_object`)
    const obj = item as Record<string, unknown>
    if (typeof obj.topic !== 'string' || !obj.topic.trim()) throw new Error(`item_${i}_missing_topic`)
    if (typeof obj.content !== 'string' || !obj.content.trim()) throw new Error(`item_${i}_missing_content`)
    return {
      topic: obj.topic,
      content: obj.content,
      heading: typeof obj.heading === 'string' ? obj.heading : undefined,
      reason: typeof obj.reason === 'string' ? obj.reason : undefined,
    }
  })
}

/** Writes already-organized segments straight into topics/topic_sections — the same find-or-create
 * by exact-title-match logic as organize-summary's own step 3, just run client-side instead of by
 * Gemini. Works because admins already have direct RLS write access to both tables. */
export async function applyManualSegments(
  courseId: string,
  summaryId: string,
  segments: ManualSegment[]
): Promise<{ topicsCreated: number; sectionsCreated: number }> {
  const { data: existingTopics } = await supabase
    .from('topics')
    .select('id, title, position')
    .eq('course_id', courseId)
    .is('parent_id', null)
    .order('position', { ascending: true })
  const list = (existingTopics ?? []) as { id: string; title: string; position: number }[]

  const normalize = (s: string) => s.trim().toLowerCase()
  const topicByName = new Map<string, { id: string; nextPosition: number }>()
  for (const t of list) topicByName.set(normalize(t.title), { id: t.id, nextPosition: 0 })
  let nextTopicPosition = list.length > 0 ? Math.max(...list.map((t) => t.position)) + 1 : 0

  if (list.length > 0) {
    const { data: counts } = await supabase
      .from('topic_sections')
      .select('topic_id')
      .in(
        'topic_id',
        list.map((t) => t.id)
      )
    const tallies = new Map<string, number>()
    for (const row of (counts ?? []) as { topic_id: string }[]) tallies.set(row.topic_id, (tallies.get(row.topic_id) ?? 0) + 1)
    for (const entry of topicByName.values()) entry.nextPosition = tallies.get(entry.id) ?? entry.nextPosition
  }

  let topicsCreated = 0
  let sectionsCreated = 0

  for (const seg of segments) {
    const key = normalize(seg.topic)
    let entry = topicByName.get(key)
    if (!entry) {
      const { data: newTopic, error: topicError } = await supabase
        .from('topics')
        .insert({ course_id: courseId, title: seg.topic.trim(), position: nextTopicPosition })
        .select('id')
        .single()
      if (topicError || !newTopic) continue
      nextTopicPosition += 1
      entry = { id: (newTopic as { id: string }).id, nextPosition: 0 }
      topicByName.set(key, entry)
      topicsCreated += 1
    }

    const { error: sectionError } = await supabase.from('topic_sections').insert({
      topic_id: entry.id,
      summary_id: summaryId,
      position: entry.nextPosition,
      heading: seg.heading?.trim() || null,
      html: seg.content,
      ai_reason: seg.reason?.trim() || null,
    })
    if (!sectionError) {
      entry.nextPosition += 1
      sectionsCreated += 1
    }
  }

  return { topicsCreated, sectionsCreated }
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
