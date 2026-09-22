-- "Report a mistake" on a shared submission: a short note visible to the submission's uploader and
-- to admins (not the whole community), so an uploader can be told about an error without opening a
-- public thread. Reuses the existing is_admin()/is_active() helpers, matching submissions' own RLS.
create table submission_flags (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  flagged_by uuid not null references profiles(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

alter table submission_flags enable row level security;

create policy submission_flags_insert on submission_flags
  for insert
  with check (is_active() and flagged_by = auth.uid());

create policy submission_flags_select on submission_flags
  for select
  using (
    is_admin()
    or flagged_by = auth.uid()
    or exists (select 1 from submissions s where s.id = submission_id and s.uploader_id = auth.uid())
  );

create policy submission_flags_admin_delete on submission_flags
  for delete
  using (is_admin());
