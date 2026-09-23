// Admin-only: given a piece of legislation's extracted plain text (already extracted client-side
// for uploaded files, or fetched here for a Google Docs link), asks Gemini to organize it into a
// simple, ordered brief — a list of {heading, content} parts. Deliberately simpler than
// generate-ruling-brief: no numbered-paragraph splitting and no paragraph-citation cross-referencing
// (that's what makes the rulings' AI generation failure-prone and its manual prompt cumbersome) —
// legislation gets the simple shape from day one, for both automatic and manual processing.
//
// Requires the same GEMINI_API_KEY secret as generate-ruling-brief/organize-summary (optional
// GEMINI_MODEL).
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

async function fetchGeminiWithRetry(url: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
  let res: Response
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await fetch(url, init)
    if (res.ok) return res
    const retryable = res.status === 503 || res.status === 429
    if (!retryable || attempt === maxAttempts) return res
    await res.text().catch(() => '')
    await new Promise((r) => setTimeout(r, attempt * 900))
  }
  return res!
}

const MAX_TEXT_CHARS = 120_000

function extractGoogleDocId(url: string): string | null {
  const m = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

type BriefPart = { heading: string; content: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const {
      data: { user },
    } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const { data: profile } = await admin.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
    if (!profile || profile.status !== 'active' || profile.role !== 'admin') return json({ error: 'not_admin' }, 403)

    const body = await req.json().catch(() => null)
    const legislationId: string | undefined = body?.legislationId
    const clientText: string | undefined = body?.text
    const googleDocsUrl: string | undefined = body?.googleDocsUrl
    if (!legislationId || (!clientText && !googleDocsUrl)) return json({ error: 'bad_request' }, 400)

    const { data: item } = await admin.from('legislation').select('id, title').eq('id', legislationId).maybeSingle()
    if (!item) return json({ error: 'not_found' }, 404)

    // ------------------------------------------------------------
    // 1. Get the raw text.
    // ------------------------------------------------------------
    let text: string
    if (clientText) {
      text = clientText
    } else {
      const docId = extractGoogleDocId(googleDocsUrl!)
      if (!docId) return json({ error: 'invalid_google_doc_url' }, 400)
      const exportRes = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`)
      if (!exportRes.ok) return json({ error: 'google_doc_not_accessible' }, 502)
      text = await exportRes.text()
    }
    text = text.trim()
    if (!text) return json({ error: 'empty_text' }, 400)
    const truncated = text.length > MAX_TEXT_CHARS
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS)

    // ------------------------------------------------------------
    // 2. Ask Gemini to organize the text into ordered, simple parts.
    // ------------------------------------------------------------
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return json({ error: 'not_configured' }, 501)
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'

    const prompt = [
      `אתם עוזרי לימוד שמארגנים טקסט חקיקה ("${item.title ?? ''}") לקריאה על ידי סטודנטים למשפטים בישראל.`,
      `להלן הטקסט. חלקו אותו לחלקים סדורים לפי סעיפים/נושאים (למשל כל סעיף או קבוצת סעיפים קשורים כחלק נפרד).`,
      `לכל חלק תנו כותרת קצרה וברורה (למשל מספר הסעיף ונושאו) ותוכן — נוסח הטקסט המקורי של אותו חלק, קריא וברור, בלי לקצר או להמציא תוכן.`,
      ``,
      `חשוב מאוד לגבי הפלט: החזירו אך ורק אובייקט JSON תקין בפורמט הזה, ללא כל טקסט נוסף לפניו או אחריו, וללא markdown code fences (בלי \`\`\`):`,
      `{"parts": [{"heading": "...", "content": "..."}, ...]}`,
      ``,
      `הטקסט:`,
      '"""',
      text,
      '"""',
    ].join('\n')

    const responseSchema = {
      type: 'object',
      properties: {
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['heading', 'content'],
          },
        },
      },
      required: ['parts'],
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
        .insert({ user_id: user.id, function: 'generate-legislation-brief', model, ok: false, error: `http_${geminiRes.status}` })
        .then(
          () => {},
          () => {}
        )
      const busy = geminiRes.status === 503 || geminiRes.status === 429
      return json({ error: busy ? 'upstream_busy' : 'upstream_error' }, 502)
    }

    const geminiData = await geminiRes.json()
    const rawParts = geminiData?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined
    const rawText = (rawParts ?? []).map((p) => p.text ?? '').join('')
    let briefParts: BriefPart[] = []
    try {
      const parsed = JSON.parse(rawText)
      if (Array.isArray(parsed?.parts)) {
        briefParts = parsed.parts.filter(
          (p: unknown): p is BriefPart =>
            !!p && typeof (p as BriefPart).heading === 'string' && typeof (p as BriefPart).content === 'string'
        )
      }
    } catch {
      briefParts = []
    }

    admin
      .from('ai_calls')
      .insert({
        user_id: user.id,
        function: 'generate-legislation-brief',
        model,
        input_tokens: geminiData?.usageMetadata?.promptTokenCount ?? null,
        output_tokens: geminiData?.usageMetadata?.candidatesTokenCount ?? null,
        ok: briefParts.length > 0,
        error: briefParts.length > 0 ? null : 'parse_error',
      })
      .then(
        () => {},
        () => {}
      )

    if (briefParts.length === 0) return json({ error: 'parse_error' }, 502)

    // ------------------------------------------------------------
    // 3. Write: save the full text, replace the brief.
    // ------------------------------------------------------------
    await admin.from('legislation').update({ full_text: text, brief_status: 'ai' }).eq('id', legislationId)

    await admin.from('legislation_briefs').delete().eq('legislation_id', legislationId)
    const { error: briefError } = await admin.from('legislation_briefs').insert({
      legislation_id: legislationId,
      sections: { parts: briefParts },
      model,
    })
    if (briefError) {
      console.error('brief insert error', briefError)
      return json({ error: 'internal_error' }, 500)
    }

    return json({ partsCount: briefParts.length, truncated })
  } catch (e) {
    console.error(e)
    return json({ error: 'internal_error' }, 500)
  }
})
