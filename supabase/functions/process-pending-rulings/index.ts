// Invoked by a pg_cron job every 15 minutes (see migration 0006_ruling_auto_processing) — finds
// rulings that have a document attached but no AI brief yet (upload succeeded, but the brief was
// never generated or a previous attempt failed, e.g. Gemini was overloaded) and retries them
// automatically, so a failed generation eventually completes without anyone having to come back
// and click "reorganize" by hand.
//
// Not reachable by normal users: verify_jwt is off for this function, and instead of a user JWT it
// checks a random shared secret (system_secrets.cron_shared_secret) that only the cron job knows,
// sent as the X-Cron-Secret header. Once authorized, it does the actual generation by calling
// generate-ruling-brief internally with the project's own service role key — that function accepts
// the service role key as a trusted "system caller" (see the comment there) so this never needs a
// real user session.
//
// A ruling attached via a Google Docs link is easy: generate-ruling-brief already fetches that
// text server-side. A ruling attached as an uploaded file (PDF/DOCX) normally has its text
// extracted client-side in the browser (pdfjs-dist/mammoth) before ever reaching the server, which
// this background job obviously can't do — so it downloads the stored file itself and extracts the
// text here instead, best-effort. If extraction fails for a given file (unsupported type, a
// scanned/image-only PDF, …), that ruling is just skipped for this run and retried again in 15
// minutes; it never blocks the rest of the batch.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1'
import mammoth from 'npm:mammoth@1.8.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// Keep each cron run short and bounded — a handful of rulings per 15-minute tick is plenty for a
// personal study portal, and it keeps one run from timing out or hammering Gemini all at once.
const BATCH_SIZE = 3

type DocRow = {
  id: string
  external_url: string | null
  blobs: { storage_path: string; mime: string } | null
}
type RulingRow = { id: string; created_at: string; documents: DocRow | null }

async function extractFromBlob(admin: ReturnType<typeof createClient>, storagePath: string, mime: string): Promise<string | null> {
  const { data: file, error } = await admin.storage.from('uploads').download(storagePath)
  if (error || !file) return null
  if (mime.includes('pdf')) {
    const buf = new Uint8Array(await file.arrayBuffer())
    const pdf = await getDocumentProxy(buf)
    const { text } = await extractText(pdf, { mergePages: true })
    return typeof text === 'string' ? text : Array.isArray(text) ? text.join('\n') : null
  }
  if (mime.includes('wordprocessingml') || mime.includes('msword')) {
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    return result.value ?? null
  }
  if (mime.startsWith('text/')) {
    return await file.text()
  }
  return null // unsupported type for server-side extraction (e.g. slides, images) — skip this cycle
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: secretRow } = await admin.from('system_secrets').select('value').eq('name', 'cron_shared_secret').maybeSingle()
    const providedSecret = req.headers.get('X-Cron-Secret')
    if (!secretRow?.value || providedSecret !== secretRow.value) return json({ error: 'unauthorized' }, 401)

    // Rulings with a document but no brief row yet, oldest first.
    const { data: rulings } = await admin
      .from('rulings')
      .select('id, created_at, documents(id, external_url, blobs(storage_path, mime))')
      .not('document_id', 'is', null)
      .order('created_at', { ascending: true })
    const candidates = (rulings ?? []) as unknown as RulingRow[]
    if (candidates.length === 0) return json({ processed: 0, skipped: 0, pending: 0 })

    const { data: briefs } = await admin
      .from('ruling_briefs')
      .select('ruling_id')
      .in(
        'ruling_id',
        candidates.map((r) => r.id)
      )
    const doneIds = new Set(((briefs ?? []) as { ruling_id: string }[]).map((b) => b.ruling_id))
    const pending = candidates.filter((r) => !doneIds.has(r.id))
    const batch = pending.slice(0, BATCH_SIZE)

    let processed = 0
    let skipped = 0
    const errors: { rulingId: string; reason: string }[] = []

    for (const ruling of batch) {
      const doc = ruling.documents
      try {
        let source: { text: string } | { googleDocsUrl: string } | null = null
        if (doc?.external_url) {
          source = { googleDocsUrl: doc.external_url }
        } else if (doc?.blobs?.storage_path) {
          const text = await extractFromBlob(admin, doc.blobs.storage_path, doc.blobs.mime ?? '')
          source = text && text.trim() ? { text } : null
        }
        if (!source) {
          skipped += 1
          errors.push({ rulingId: ruling.id, reason: 'no_extractable_text' })
          continue
        }

        const res = await fetch(`${supabaseUrl}/functions/v1/generate-ruling-brief`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({ rulingId: ruling.id, ...source }),
        })
        if (res.ok) {
          processed += 1
        } else {
          skipped += 1
          const body = await res.json().catch(() => null)
          errors.push({ rulingId: ruling.id, reason: (body as { error?: string } | null)?.error ?? `http_${res.status}` })
        }
      } catch (e) {
        skipped += 1
        errors.push({ rulingId: ruling.id, reason: e instanceof Error ? e.message : 'unknown_error' })
      }
    }

    return json({ processed, skipped, pending: pending.length - batch.length, errors })
  } catch (e) {
    console.error(e)
    return json({ error: 'internal_error' }, 500)
  }
})
