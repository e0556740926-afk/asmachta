-- Allow active members to read files from the private 'uploads' bucket.
-- Previously only admins could read (uploads_admin_all), which meant admins could
-- upload course files but no member could ever open/download them — the DB-level
-- visibility gating (summaries_select_published etc.) already controls which rows
-- members can see; this just lets them fetch the bytes for a row they can already see.
-- Paths are content-addressed by sha256 (unguessable), so this does not expose a
-- directory listing or let members read files they were never given a link to.
create policy uploads_select_active on storage.objects for select
  using (bucket_id = 'uploads' and public.is_active());
