// Any active member (not admin-only, unlike organize-summary/generate-ruling-brief): given a
// `submissions` row whose `document_id` points at a Google Docs link (see lib/upload.ts's
// addExternalDocument), fetches the doc's plain text server-side (Google Docs blocks browser CORS
// for this) and writes it into `submissions.body_html` — no AI call, no writes to the curated
// topics/topic_sections tables. That keeps community submissions fully separate from the
// admin-only "organize into the official topic map" pipeline: a member can submit and a
// pending/rejected submission never touches curated content.
//
// Doubles as the "reorganize" retry for Shared, mirroring the retry button Summaries/Rulings
// already have — same call, just re-run after a transient fetch failure.
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

const MAX_TEXT_CHARS = 60_000

function extractGoogleDocId(url: string): string | null {
  const m = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
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
    if (!profile || profile.status !== 'active') return json({ error: 'unauthorized' }, 401)

    const body = await req.json().catch(() => null)
    const submissionId: string | undefined = body?.submissionId
    if (!submissionId) return json({ error: 'bad_request' }, 400)

    const { data: submission } = await admin
      .from('submissions')
      .select('id, uploader_id, document_id')
      .eq('id', submissionId)
      .maybeSingle()
    if (!submission) return json({ error: 'not_found' }, 404)
    if (submission.uploader_id !== user.id && profile.role !== 'admin') return json({ error: 'forbidden' }, 403)
    if (!submission.document_id) return json({ error: 'no_link' }, 400)

    const { data: doc } = await admin.from('documents').select('external_url').eq('id', submission.document_id).maybeSingle()
    if (!doc?.external_url) return json({ error: 'no_link' }, 400)

    const docId = extractGoogleDocId(doc.external_url)
    if (!docId) return json({ error: 'invalid_google_doc_url' }, 400)
    const exportRes = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`)
    if (!exportRes.ok) return json({ error: 'google_doc_not_accessible' }, 502)
    let text = (await exportRes.text()).trim()
    if (!text) return json({ error: 'empty_text' }, 400)
    const truncated = text.length > MAX_TEXT_CHARS
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS)

    const { error: updateError } = await admin
      .from('submissions')
      .update({ body_html: text })
      .eq('id', submissionId)
    if (updateError) {
      console.error('submission update error', updateError)
      return json({ error: 'internal_error' }, 500)
    }

    return json({ length: text.length, truncated })
  } catch (e) {
    console.error(e)
    return json({ error: 'internal_error' }, 500)
  }
})
