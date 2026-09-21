-- Allow a document to be an external link (e.g. a Google Docs URL) instead of an uploaded file.
alter table public.documents alter column blob_sha256 drop not null;
alter table public.documents add column external_url text;
alter table public.documents add constraint documents_source_check check (
  (blob_sha256 is not null and external_url is null) or (blob_sha256 is null and external_url is not null)
);
