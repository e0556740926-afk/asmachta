// Admin-only: asks Gemini to draft flashcards or MCQ quiz questions for a course, as a starting
// point the admin reviews/edits before saving anything to the DB. Nothing is written by this
// function — it only returns suggestions.
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
    const courseTitle: string | undefined = body?.courseTitle
    const mode: string | undefined = body?.mode
    const count = Math.min(Math.max(Number(body?.count) || 8, 1), 20)
    if (!courseTitle || (mode !== 'cards' && mode !== 'quiz')) return json({ error: 'bad_request' }, 400)

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return json({ error: 'not_configured' }, 501)
    // Pinned to a specific stable GA model rather than the `-latest` alias: that alias hot-swaps
    // to whatever Gemini just released, which tends to be capacity-constrained (503s) right
    // after launch. gemini-2.5-flash was tried first but Google has retired it for new callers
    // (404, "no longer available to new users") — gemini-3.6-flash is their suggested, stable
    // replacement. Override with the GEMINI_MODEL secret any time, no redeploy needed.
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'

    const responseSchema =
      mode === 'cards'
        ? {
            type: 'array',
            items: {
              type: 'object',
              properties: { front: { type: 'string' }, back: { type: 'string' } },
              required: ['front', 'back'],
            },
          }
        : {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                stem: { type: 'string' },
                options: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 5 },
                answer: { type: 'string' },
                explanation: { type: 'string' },
              },
              required: ['stem', 'options', 'answer'],
            },
          }

    const prompt =
      mode === 'cards'
        ? `צרו ${count} כרטיסיות זיכרון (front/back) ללימוד הקורס "${courseTitle}" בפקולטה למשפטים. ` +
          'ה-front הוא שאלה או מונח קצר, וה-back הוא תשובה/הגדרה תמציתית ומדויקת. השתמשו בעברית משפטית תקנית.'
        : `צרו ${count} שאלות אמריקאיות (רב-ברירה) ללימוד הקורס "${courseTitle}" בפקולטה למשפטים. ` +
          'לכל שאלה: stem (השאלה), options (3-5 תשובות אפשריות), answer (הטקסט המדויק של התשובה הנכונה מתוך options), ' +
          'ו-explanation קצר (אופציונלי) שמסביר למה זו התשובה הנכונה. השתמשו בעברית משפטית תקנית.'

    const disclaimer =
      'שימו לב: אין לכם גישה לחומרי הקורס הספציפיים שהועלו לאפליקציה (סיכומים, פסקי דין) — ' +
      'התבססו על הידע המשפטי הכללי שלכם לגבי נושא הקורס, ואל תמציאו ציטוטים או מקורות ספציפיים.'

    const geminiRes = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${prompt}\n\n${disclaimer}` }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema },
        }),
      }
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '')
      console.error('gemini error', geminiRes.status, errText)
      admin
        .from('ai_calls')
        .insert({ user_id: user.id, function: 'generate-practice', model, ok: false, error: `http_${geminiRes.status}` })
        .then(
          () => {},
          () => {}
        )
      const busy = geminiRes.status === 503 || geminiRes.status === 429
      return json({ error: busy ? 'upstream_busy' : 'upstream_error' }, 502)
    }

    const geminiData = await geminiRes.json()
    const parts = geminiData?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined
    const text = (parts ?? []).map((p) => p.text ?? '').join('')

    let items: unknown
    try {
      items = JSON.parse(text)
    } catch {
      items = null
    }

    admin
      .from('ai_calls')
      .insert({
        user_id: user.id,
        function: 'generate-practice',
        model,
        input_tokens: geminiData?.usageMetadata?.promptTokenCount ?? null,
        output_tokens: geminiData?.usageMetadata?.candidatesTokenCount ?? null,
        ok: Array.isArray(items),
        error: Array.isArray(items) ? null : 'parse_error',
      })
      .then(
        () => {},
        () => {}
      )

    if (!Array.isArray(items)) return json({ error: 'parse_error' }, 502)
    return json({ items })
  } catch (e) {
    console.error(e)
    return json({ error: 'internal_error' }, 500)
  }
})
