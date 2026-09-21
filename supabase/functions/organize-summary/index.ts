// Admin-only: given a `summaries` row plus its extracted plain text (already extracted
// client-side for uploaded files, or fetched here for a Google Docs link), asks Gemini to split
// the text into topic-tagged sections and writes them into the `topics` / `topic_sections`
// tables — the schema from the original plan (migration 0001) that this wires up for the first
// time. Existing topics for the course are reused by exact-title match; new ones are created.
//
// Requires the same `GEMINI_API_KEY` secret as `agent-chat` (optional `GEMINI_MODEL` override).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Gemini occasionally returns 503 ("high demand") or 429 (rate limit) — both are usually
// transient, so retry a couple of times with a short backoff before giving up.
async function fetchGeminiWithRetry(url: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
  let res: Response
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await fetch(url, init)
    if (res.ok) return res
    const retryable = res.status === 503 || res.status === 429
    if (!retryable || attempt === maxAttempts) return res
    await res.text().catch(() => '') // drain the body before retrying
    await new Promise((r) => setTimeout(r, attempt * 900))
  }
  return res!
}

const MAX_TEXT_CHARS = 120_000

function extractGoogleDocId(url: string): string | null {
  const m = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

type Segment = { topic: string; heading?: string; content: string; reason?: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const {
      data: { user },
    } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { data: profile } = await admin.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
    if (!profile || profile.status !== 'active' || profile.role !== 'admin') return json({ error: 'not_admin' }, 403)

    const body = await req.json().catch(() => null)
    const summaryId: string | undefined = body?.summaryId
    const clientText: string | undefined = body?.text
    const googleDocsUrl: string | undefined = body?.googleDocsUrl
    if (!summaryId || (!clientText && !googleDocsUrl)) return json({ error: 'bad_request' }, 400)

    const { data: summary } = await admin.from('summaries').select('id, course_id, title').eq('id', summaryId).maybeSingle()
    if (!summary) return json({ error: 'not_found' }, 404)

    // ------------------------------------------------------------
    // 1. Get the raw text — already extracted client-side for a file, or fetched here for a
    //    Google Docs link (works when the doc's sharing is "anyone with the link can view";
    //    no Drive OAuth needed).
    // ------------------------------------------------------------
    let text: string
    if (clientText) {
      text = clientText
    } else {
      const docId = extractGoogleDocId(googleDocsUrl!)
      if (!docId) return json({ error: 'invalid_google_doc_url' }, 400)
      const exportRes = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`)
      if (!exportRes.ok) {
        return json({ error: 'google_doc_not_accessible' }, 502)
      }
      text = await exportRes.text()
    }
    text = text.trim()
    if (!text) return json({ error: 'empty_text' }, 400)
    const truncated = text.length > MAX_TEXT_CHARS
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS)

    await admin.from('summaries').update({ raw_html: text }).eq('id', summaryId)

    // ------------------------------------------------------------
    // 2. Ask Gemini to split the text into topic-tagged sections, reusing existing topic titles
    //    for this course where they fit.
    // ------------------------------------------------------------
    const { data: courseRow } = await admin.from('courses').select('title').eq('id', summary.course_id).maybeSingle()
    const { data: existingTopics } = await admin
      .from('topics')
      .select('id, title, position')
      .eq('course_id', summary.course_id)
      .is('parent_id', null)
      .order('position', { ascending: true })
    const existingTopicList = (existingTopics ?? []) as { id: string; title: string; position: number }[]

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return json({ error: 'not_configured' }, 501)
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'

    const existingTopicsBlock =
      existingTopicList.length > 0 ? existingTopicList.map((t) => `- ${t.title}`).join('\n') : '(אין נושאים קיימים עדיין בקורס הזה)'

    const prompt = [
      `אתם עוזרי לימוד שמארגנים סיכום לימודי של הקורס "${courseRow?.title ?? ''}" (פקולטה למשפטים בישראל) לפי נושאים.`,
      `להלן טקסט שחולץ ממסמך סיכום שהועלה עכשיו לקורס. חלקו אותו למקטעים לפי נושא משפטי.`,
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
      `הטקסט:`,
      '"""',
      text,
      '"""',
    ].join('\n')

    const responseSchema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          heading: { type: 'string' },
          content: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['topic', 'content'],
      },
    }

    const geminiRes = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema },
        }),
      }
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '')
      console.error('gemini error', geminiRes.status, errText)
      admin
        .from('ai_calls')
        .insert({ user_id: user.id, function: 'organize-summary', model, ok: false, error: `http_${geminiRes.status}` })
        .then(
          () => {},
          () => {}
        )
      const busy = geminiRes.status === 503 || geminiRes.status === 429
      return json({ error: busy ? 'upstream_busy' : 'upstream_error' }, 502)
    }

    const geminiData = await geminiRes.json()
    const parts = geminiData?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined
    const rawText = (parts ?? []).map((p) => p.text ?? '').join('')
    let segments: Segment[] = []
    try {
      const parsed = JSON.parse(rawText)
      if (Array.isArray(parsed)) segments = parsed.filter((s) => s && typeof s.topic === 'string' && typeof s.content === 'string')
    } catch {
      segments = []
    }

    admin
      .from('ai_calls')
      .insert({
        user_id: user.id,
        function: 'organize-summary',
        model,
        input_tokens: geminiData?.usageMetadata?.promptTokenCount ?? null,
        output_tokens: geminiData?.usageMetadata?.candidatesTokenCount ?? null,
        ok: segments.length > 0,
        error: segments.length > 0 ? null : 'parse_error',
      })
      .then(
        () => {},
        () => {}
      )

    // ------------------------------------------------------------
    // 3. Find-or-create each segment's topic, then insert its topic_section.
    // ------------------------------------------------------------
    const normalize = (s: string) => s.trim().toLowerCase()
    const topicByName = new Map<string, { id: string; nextPosition: number }>()
    for (const t of existingTopicList) topicByName.set(normalize(t.title), { id: t.id, nextPosition: 0 })
    let nextTopicPosition = existingTopicList.length > 0 ? Math.max(...existingTopicList.map((t) => t.position)) + 1 : 0

    // Seed each existing topic's next section position from its current section count.
    if (existingTopicList.length > 0) {
      const { data: counts } = await admin
        .from('topic_sections')
        .select('topic_id')
        .in(
          'topic_id',
          existingTopicList.map((t) => t.id)
        )
      const tallies = new Map<string, number>()
      for (const row of (counts ?? []) as { topic_id: string }[]) tallies.set(row.topic_id, (tallies.get(row.topic_id) ?? 0) + 1)
      for (const entry of topicByName.values()) entry.nextPosition = tallies.get(entry.id) ?? 0
    }

    let topicsCreated = 0
    let sectionsCreated = 0

    for (const seg of segments) {
      const key = normalize(seg.topic)
      let entry = topicByName.get(key)
      if (!entry) {
        const { data: newTopic, error: topicError } = await admin
          .from('topics')
          .insert({ course_id: summary.course_id, title: seg.topic.trim(), position: nextTopicPosition })
          .select('id')
          .single()
        if (topicError || !newTopic) continue
        nextTopicPosition += 1
        entry = { id: (newTopic as { id: string }).id, nextPosition: 0 }
        topicByName.set(key, entry)
        topicsCreated += 1
      }

      const { error: sectionError } = await admin.from('topic_sections').insert({
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

    return json({ topicsCreated, sectionsCreated, truncated })
  } catch (e) {
    console.error(e)
    return json({ error: 'internal_error' }, 500)
  }
})
