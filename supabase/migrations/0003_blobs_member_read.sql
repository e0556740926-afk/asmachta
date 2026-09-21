-- Members need to read a document's storage_path (on `blobs`) to build a download link for
-- anything they're already allowed to see via `documents_select` — `blobs_admin_all` alone left
-- that path invisible to everyone but admins, which silently broke downloads for members even
-- after uploads_select_active (0002) opened up the storage object itself.
create policy blobs_select_active on public.blobs for select using (
  public.is_active() and exists (
    select 1 from public.documents d where d.blob_sha256 = blobs.sha256
      and (d.owner_id = auth.uid() or (d.visibility = 'core' and d.status = 'approved'))
  )
);
