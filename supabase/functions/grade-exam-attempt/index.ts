// Any active member (not admin-only — a student grades their own attempt): given a submitted
// exam_attempts row, asks Gemini to grade the student's free-text answer against the exam's
// admin-written rubric and writes structured feedback back onto the attempt — the exams /
// exam_attempts tables from the original plan (migration 0001), wired up for the first time.
//
// Requires the same GEMINI_API_KEY secret as the other AI functions (optional GEMINI_MODEL).
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

type CriteriaFeedback = { criterion: string; feedback: string }
type Feedback = { score: number; strengths: string[]; improvements: string[]; criteriaFeedback?: CriteriaFeedback[] }

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
    const { data: profile } = await admin.from('profiles').select('status').eq('id', user.id).maybeSingle()
    if (!profile || profile.status !== 'active') return json({ error: 'not_active' }, 403)

    const body = await req.json().catch(() => null)
    const attemptId: string | undefined = body?.attemptId
    if (!attemptId) return json({ error: 'bad_request' }, 400)

    const { data: attempt } = await admin
      .from('exam_attempts')
      .select('id, user_id, exam_id, answer_html, submitted_at')
      .eq('id', attemptId)
      .maybeSingle()
    if (!attempt) return json({ error: 'not_found' }, 404)
    if (attempt.user_id !== user.id) return json({ error: 'forbidden' }, 403)
    if (!attempt.submitted_at || !attempt.answer_html?.trim()) return json({ error: 'not_submitted' }, 400)

    const { data: exam } = await admin.from('exams').select('title, rubric').eq('id', attempt.exam_id).maybeSingle()
    const rubricText = (exam?.rubric as { text?: string } | null)?.text?.trim() || ''

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return json({ error: 'not_configured' }, 501)
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'

    const prompt = [
      `אתם בוחנים תשובת סטודנט לשאלת בחינה בקורס משפטים ("${exam?.title ?? ''}"), ונותנים משוב לימודי בעברית.`,
      rubricText
        ? `להלן המחוון / נקודות המפתח שנקבעו על ידי המרצה/המנהל לתשובה הטובה:\n"""\n${rubricText}\n"""`
        : `לא סופק מחוון ספציפי — העריכו לפי הבנתכם המשפטית הכללית של איכות התשובה (זיהוי הסוגיה, ניתוח, יישום על העובדות, מסקנה מנומקת).`,
      ``,
      `להלן תשובת הסטודנט:`,
      '"""',
      attempt.answer_html,
      '"""',
      ``,
      `תנו משוב הכולל: ציון מספרי (0-100), רשימת חוזקות קצרה, רשימת נקודות לשיפור קצרה, ואם יש מחוון עם קריטריונים ברורים — התייחסות ספציפית לכל קריטריון (כמה טוב הוא כוסה בתשובה).`,
    ].join('\n')

    const responseSchema = {
      type: 'object',
      properties: {
        score: { type: 'integer' },
        strengths: { type: 'array', items: { type: 'string' } },
        improvements: { type: 'array', items: { type: 'string' } },
        criteriaFeedback: {
          type: 'array',
          items: {
            type: 'object',
            properties: { criterion: { type: 'string' }, feedback: { type: 'string' } },
            required: ['criterion', 'feedback'],
          },
        },
      },
      required: ['score', 'strengths', 'improvements'],
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
        .insert({ user_id: user.id, function: 'grade-exam-attempt', model, ok: false, error: `http_${geminiRes.status}` })
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
    let feedback: Feedback | null = null
    try {
      const parsed = JSON.parse(rawText)
      if (typeof parsed?.score === 'number' && Array.isArray(parsed?.strengths) && Array.isArray(parsed?.improvements)) {
        feedback = {
          score: Math.max(0, Math.min(100, Math.round(parsed.score))),
          strengths: parsed.strengths,
          improvements: parsed.improvements,
          criteriaFeedback: Array.isArray(parsed.criteriaFeedback) ? parsed.criteriaFeedback : undefined,
        }
      }
    } catch {
      feedback = null
    }

    admin
      .from('ai_calls')
      .insert({
        user_id: user.id,
        function: 'grade-exam-attempt',
        model,
        input_tokens: geminiData?.usageMetadata?.promptTokenCount ?? null,
        output_tokens: geminiData?.usageMetadata?.candidatesTokenCount ?? null,
        ok: feedback !== null,
        error: feedback !== null ? null : 'parse_error',
      })
      .then(
        () => {},
        () => {}
      )

    if (!feedback) return json({ error: 'parse_error' }, 502)

    await admin.from('exam_attempts').update({ feedback }).eq('id', attemptId)

    return json(feedback)
  } catch (e) {
    console.error(e)
    return json({ error: 'internal_error' }, 500)
  }
})
