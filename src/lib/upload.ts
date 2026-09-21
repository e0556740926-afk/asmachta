import { supabase, type DocumentKind } from './supabase'

const BUCKET = 'uploads'

/** Hex-encoded SHA-256 of a File, computed client-side. Used as the content-address for storage
 * (dedupe: identical bytes are only ever stored once, matching the `blobs` table design). */
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export type UploadResult = { documentId: string; deduped: boolean }

/**
 * Uploads a file and returns a `documents` row id for it.
 * - Hashes the file client-side and checks `blobs` for that hash first.
 * - If the same bytes were already uploaded before, skips the storage upload entirely and just
 *   bumps `ref_count` (`deduped: true`) — e.g. the same PDF attached under two courses.
 * - Otherwise uploads to the private `uploads` bucket at a content-addressed path and inserts a
 *   new `blobs` row.
 * - Always inserts a fresh `documents` row (a blob can back more than one document/summary).
 *
 * Requires admin — matches the current storage/`blobs` RLS policies (uploads_admin_all,
 * blobs_admin_all). Members can only ever be given a signed download link, never write access.
 */
export async function uploadDocument(
  file: File,
  opts: { kind: DocumentKind; ownerId: string; visibility?: 'core' | 'shared' | 'private' }
): Promise<UploadResult> {
  const sha256 = await sha256Hex(file)
  const storagePath = `${sha256}/${file.name}`

  const { data: existingBlob } = await supabase.from('blobs').select('sha256, ref_count').eq('sha256', sha256).maybeSingle()

  let deduped = false
  if (existingBlob) {
    deduped = true
    await supabase
      .from('blobs')
      .update({ ref_count: (existingBlob as { ref_count: number }).ref_count + 1 })
      .eq('sha256', sha256)
  } else {
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
    if (uploadError && !uploadError.message.toLowerCase().includes('already exists')) throw uploadError
    const { error: blobError } = await supabase.from('blobs').insert({
      sha256,
      bytes: file.size,
      mime: file.type || 'application/octet-stream',
      storage_path: storagePath,
      ref_count: 1,
    })
    if (blobError) throw blobError
  }

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      blob_sha256: sha256,
      kind: opts.kind,
      original_filename: file.name,
      owner_id: opts.ownerId,
      visibility: opts.visibility ?? 'core',
      status: 'approved',
    })
    .select('id')
    .single()
  if (docError) throw docError

  return { documentId: (doc as { id: string }).id, deduped }
}

/**
 * Registers an external link (e.g. a Google Docs URL) as a `documents` row, with no file upload
 * or `blobs` row involved. Used when a course member wants to attach a doc that already lives on
 * Google Docs instead of uploading a file.
 */
export async function addExternalDocument(
  url: string,
  opts: { kind: DocumentKind; ownerId: string; title?: string; visibility?: 'core' | 'shared' | 'private' }
): Promise<{ documentId: string }> {
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('invalid_url')

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      external_url: trimmed,
      kind: opts.kind,
      original_filename: opts.title ?? null,
      owner_id: opts.ownerId,
      visibility: opts.visibility ?? 'core',
      status: 'approved',
    })
    .select('id')
    .single()
  if (docError) throw docError

  return { documentId: (doc as { id: string }).id }
}

/** Signed, time-limited download URL for a document's underlying file. */
export async function getDownloadUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}

/** Deletes a document row. The underlying blob/storage object is left alone (ref_count still
 * tracks other documents that may share it) — a periodic admin job can sweep unreferenced blobs
 * later; not needed for M1 volumes. */
export async function deleteDocument(documentId: string): Promise<void> {
  const { error } = await supabase.from('documents').delete().eq('id', documentId)
  if (error) throw error
}
