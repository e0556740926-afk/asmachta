// Admin-only: given a ruling's extracted plain text (already extracted client-side for uploaded
// files, or fetched here for a Google Docs link), asks Gemini to (1) split the text into numbered,
// citable paragraphs and (2) write a structured AI brief whose parts/key-points reference those
// paragraph numbers — the ruling_paragraphs / ruling_briefs tables from the original plan
// (migration 0001) that this wires up for the first time. Also best-effort infers case metadata
// (court, case number, decision date, …) from the text to fill in rulings columns left empty.
//
// Requires the same GEMINI_API_KEY secret as agent-chat/organize-summary (optional GEMINI_MODEL).
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

type Paragraph = { n: number; text: string }
type BriefPart = { heading: string; content: string; paragraphNumbers?: number[] }
type BriefKeyPoint = { label: string; paragraphNumbers?: number[] }
type CaseMeta = {
  caseType?: string
  caseNumber?: string
  court?: string
  decisionDate?: string
  citation?: string
}

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

    // The automatic every-15-minutes retry (process-pending-rulings, invoked by pg_cron) has no
    // end-user session to authenticate — it calls straight through with the project's own service
    // role key as the bearer token, which only server-side code ever holds. Treat that one exact
    // value as a trusted system caller and skip the admin-profile check; everyone else still needs
    // a real logged-in admin, exactly as before.
    const isSystemCaller = authHeader === `Bearer ${serviceRoleKey}`
    let callerUserId: string | null = null
    if (!isSystemCaller) {
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
      const {
        data: { user },
      } = await userClient.auth.getUser()
      if (!user) return json({ error: 'unauthorized' }, 401)

      const { data: profile } = await admin.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
      if (!profile || profile.status !== 'active' || profile.role !== 'admin') return json({ error: 'not_admin' }, 403)
      callerUserId = user.id
    }

    const body = await req.json().catch(() => null)
    const rulingId: string | undefined = body?.rulingId
    const clientText: string | undefined = body?.text
    const googleDocsUrl: string | undefined = body?.googleDocsUrl
    if (!rulingId || (!clientText && !googleDocsUrl)) return json({ error: 'bad_request' }, 400)

    const { data: ruling } = await admin.from('rulings').select('id, title').eq('id', rulingId).maybeSingle()
    if (!ruling) return json({ error: 'not_found' }, 404)

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
    // 2. Ask Gemini to number the paragraphs and write a structured, citation-linked brief.
    // ------------------------------------------------------------
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return json({ error: 'not_configured' }, 501)
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'

    const prompt = [
      `אתם עוזרי לימוד שמכינים פסק דין ("${ruling.title ?? ''}") לקריאה על ידי סטודנטים למשפטים בישראל.`,
      `להלן טקסט פסק הדין. בצעו שתי משימות:`,
      ``,
      `משימה 1 — חלוקה לפסקאות ממוספרות: חלקו את הטקסט לפסקאות עוקבות וממוספרות (1, 2, 3, ...) שישמשו כמקור לציטוט. שמרו על נוסח הטקסט המקורי בכל פסקה (אל תמציאו ואל תשמיטו תוכן מהותי), אך אפשר לפצל פסקאות ארוכות מדי או לאחד משפטים קצרים מדי.`,
      ``,
      `משימה 2 — תמצית AI מובנית: כתבו תמצית לימודית בעברית שמסבירה מה עומד במרכז פסק הדין, בכמה חלקים קצרים (כמו: "מה עומד במרכז פסק הדין", "השאלה המשפטית", "העיקרון ללמידה") — לכל חלק תנו כותרת קצרה, תוכן של פסקה-שתיים, ורשימת מספרי הפסקאות (מתוך המספור שקבעתם במשימה 1) שהחלק מתבסס עליהן. בנוסף כתבו 2-4 "נקודות מפתח" קצרות (משפט אחד כל אחת) עם מספרי הפסקאות הרלוונטיות להן.`,
      ``,
      `בנוסף, אם ניתן לזהות מהטקסט את הפרטים הבאים — ציינו אותם (אחרת השאירו null): סוג ההליך (caseType, למשל "ע״א"/"בג״ץ"), מספר התיק (caseNumber), שם הערכאה (court), תאריך מתן פסק הדין בפורמט YYYY-MM-DD (decisionDate), ואזכור משפטי מקובל (citation).`,
      ``,
      `הטקסט:`,
      '"""',
      text,
      '"""',
    ].join('\n')

    const responseSchema = {
      type: 'object',
      properties: {
        paragraphs: {
          type: 'array',
          items: {
            type: 'object',
            properties: { n: { type: 'integer' }, text: { type: 'string' } },
            required: ['n', 'text'],
          },
        },
        brief: {
          type: 'object',
          properties: {
            parts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  heading: { type: 'string' },
                  content: { type: 'string' },
                  paragraphNumbers: { type: 'array', items: { type: 'integer' } },
                },
                required: ['heading', 'content'],
              },
            },
            keyPoints: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  paragraphNumbers: { type: 'array', items: { type: 'integer' } },
                },
                required: ['label'],
              },
            },
          },
          required: ['parts'],
        },
        caseMeta: {
          type: 'object',
          properties: {
            caseType: { type: 'string' },
            caseNumber: { type: 'string' },
            court: { type: 'string' },
            decisionDate: { type: 'string' },
            citation: { type: 'string' },
          },
        },
      },
      required: ['paragraphs', 'brief'],
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
        .insert({ user_id: callerUserId, function: 'generate-ruling-brief', model, ok: false, error: `http_${geminiRes.status}` })
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
    let paragraphs: Paragraph[] = []
    let briefParts: BriefPart[] = []
    let keyPoints: BriefKeyPoint[] = []
    let caseMeta: CaseMeta = {}
    try {
      const parsed = JSON.parse(rawText)
      if (Array.isArray(parsed?.paragraphs)) {
        paragraphs = parsed.paragraphs.filter(
          (p: unknown): p is Paragraph => !!p && typeof (p as Paragraph).n === 'number' && typeof (p as Paragraph).text === 'string'
        )
      }
      if (Array.isArray(parsed?.brief?.parts)) briefParts = parsed.brief.parts
      if (Array.isArray(parsed?.brief?.keyPoints)) keyPoints = parsed.brief.keyPoints
      if (parsed?.caseMeta && typeof parsed.caseMeta === 'object') caseMeta = parsed.caseMeta
    } catch {
      paragraphs = []
    }

    admin
      .from('ai_calls')
      .insert({
        user_id: callerUserId,
        function: 'generate-ruling-brief',
        model,
        input_tokens: geminiData?.usageMetadata?.promptTokenCount ?? null,
        output_tokens: geminiData?.usageMetadata?.candidatesTokenCount ?? null,
        ok: paragraphs.length > 0,
        error: paragraphs.length > 0 ? null : 'parse_error',
      })
      .then(
        () => {},
        () => {}
      )

    if (paragraphs.length === 0) return json({ error: 'parse_error' }, 502)

    // ------------------------------------------------------------
    // 3. Write: replace this ruling's paragraphs + brief, update case metadata if inferred.
    // ------------------------------------------------------------
    await admin.from('ruling_paragraphs').delete().eq('ruling_id', rulingId)
    const paragraphRows = paragraphs.map((p, i) => ({
      ruling_id: rulingId,
      n: p.n,
      seq: i,
      text: p.text,
    }))
    const { error: paraError } = await admin.from('ruling_paragraphs').insert(paragraphRows)
    if (paraError) {
      console.error('paragraph insert error', paraError)
      return json({ error: 'internal_error' }, 500)
    }

    await admin.from('ruling_briefs').delete().eq('ruling_id', rulingId)
    const { error: briefError } = await admin.from('ruling_briefs').insert({
      ruling_id: rulingId,
      sections: { parts: briefParts, keyPoints },
      model,
    })
    if (briefError) console.error('brief insert error', briefError)

    // The model is asked to write "null" (as text) for fields it can't determine, since the
    // response schema declares them as plain strings rather than nullable — filter that (and
    // blank/whitespace-only strings) back out so it never lands in the DB as a literal "null".
    function meaningful(v?: string): string | undefined {
      const trimmed = v?.trim()
      return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : undefined
    }

    const metaUpdate: Record<string, string> = {}
    const caseType = meaningful(caseMeta.caseType)
    const caseNumber = meaningful(caseMeta.caseNumber)
    const court = meaningful(caseMeta.court)
    const citation = meaningful(caseMeta.citation)
    if (caseType) metaUpdate.case_type = caseType
    if (caseNumber) metaUpdate.case_number = caseNumber
    if (court) metaUpdate.court = court
    if (caseMeta.decisionDate && /^\d{4}-\d{2}-\d{2}$/.test(caseMeta.decisionDate)) metaUpdate.decision_date = caseMeta.decisionDate
    if (citation) metaUpdate.citation = citation
    await admin
      .from('rulings')
      .update({ brief_status: 'ai', ...metaUpdate })
      .eq('id', rulingId)

    return json({ paragraphCount: paragraphRows.length, partsCount: briefParts.length, truncated })
  } catch (e) {
    console.error(e)
    return json({ error: 'internal_error' }, 500)
  }
})
