// Proxies chat requests to Google's Gemini API for the in-app study agent (✦).
// Keeps the Gemini key server-side only — the browser never sees it.
//
// Requires a project secret `GEMINI_API_KEY` (get one at https://aistudio.google.com/apikey).
// Optional secret `GEMINI_MODEL` overrides the default model id without a redeploy.
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// Supabase for every Edge Function — nothing to configure for those.
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

type ChatMessage = { role: 'user' | 'model'; content: string }

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

    // Identifies the caller from their JWT (RLS-respecting client — just for auth.getUser()).
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const {
      data: { user },
    } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    // Service-role client for the profile/quota check and usage logging — bypasses RLS
    // deliberately (ai_calls is admin-only to query/write directly; this function is the
    // trusted path that's allowed to write on a user's behalf).
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: profile } = await admin
      .from('profiles')
      .select('status, agent_daily_quota')
      .eq('id', user.id)
      .maybeSingle()
    if (!profile || profile.status !== 'active') return json({ error: 'not_active' }, 403)

    const since = new Date()
    since.setHours(0, 0, 0, 0)
    const { count } = await admin
      .from('ai_calls')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since.toISOString())
    if ((count ?? 0) >= profile.agent_daily_quota) return json({ error: 'quota_exceeded' }, 429)

    const body = await req.json().catch(() => null)
    const message: string | undefined = body?.message
    const context: string | undefined = body?.context
    const history: ChatMessage[] = Array.isArray(body?.history) ? body.history : []
    if (!message || typeof message !== 'string' || !message.trim()) return json({ error: 'bad_request' }, 400)

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return json({ error: 'not_configured' }, 501)
    // Pinned to a specific stable GA model rather than the `-latest` alias: that alias hot-swaps
    // to whatever Gemini just released, which tends to be capacity-constrained (503s) right
    // after launch. gemini-2.5-flash was tried first but Google has retired it for new callers
    // (404, "no longer available to new users") — gemini-3.6-flash is their suggested, stable
    // replacement. Override with the GEMINI_MODEL secret any time, no redeploy needed.
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'

    const systemInstruction = [
      'אתם הסוכן הלימודי של "אסמכתא", אפליקציה לסטודנטים למשפטים בישראל.',
      'ענו תמיד בעברית, בתמציתיות ובבהירות, בסגנון לימודי-משפטי.',
      'עדיין אין לכם גישה לחומרי הקורס הספציפיים שהועלו לאפליקציה (סיכומים, פסקי דין) — ' +
        'אם השאלה דורשת ציטוט מדויק מחומר קורס, ציינו זאת בפירוש ואל תמציאו ציטוט או מקור.',
      'אפשר לענות מהידע המשפטי הכללי שלכם, אך תמיד בזהירות ובלי להתחזות למקור רשמי.',
    ].join(' ')

    const contents = [
      ...history
        .filter((h) => h && typeof h.content === 'string' && (h.role === 'user' || h.role === 'model'))
        .map((h) => ({ role: h.role, parts: [{ text: h.content }] })),
      { role: 'user', parts: [{ text: context ? `[הקשר נוכחי: ${context}]\n${message}` : message }] },
    ]

    const geminiRes = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemInstruction }] } }),
      }
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '')
      console.error('gemini error', geminiRes.status, errText)
      admin
        .from('ai_calls')
        .insert({ user_id: user.id, function: 'agent-chat', model, ok: false, error: `http_${geminiRes.status}` })
        .then(
          () => {},
          () => {}
        )
      const busy = geminiRes.status === 503 || geminiRes.status === 429
      return json({ error: busy ? 'upstream_busy' : 'upstream_error' }, 502)
    }

    const geminiData = await geminiRes.json()
    const parts = geminiData?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined
    const reply = (parts ?? []).map((p) => p.text ?? '').join('') || ''

    admin
      .from('ai_calls')
      .insert({
        user_id: user.id,
        function: 'agent-chat',
        model,
        input_tokens: geminiData?.usageMetadata?.promptTokenCount ?? null,
        output_tokens: geminiData?.usageMetadata?.candidatesTokenCount ?? null,
        ok: true,
      })
      .then(
        () => {},
        () => {}
      )

    if (!reply) return json({ error: 'empty_reply' }, 502)
    return json({ reply })
  } catch (e) {
    console.error(e)
    return json({ error: 'internal_error' }, 500)
  }
})
