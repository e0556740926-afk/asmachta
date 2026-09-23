-- Legislation ("חקיקה") — a separate, simpler sibling of rulings. Rulings' automatic brief
-- generation splits the source into numbered, citable paragraphs cross-referenced by the brief
-- (see generate-ruling-brief) — powerful for case-law close-reading, but that paragraph-citation
-- requirement is exactly what makes AI generation failure-prone and makes a hand-run manual prompt
-- cumbersome. Legislation gets its own document+brief model from day one with the simple shape
-- (ordered heading+content parts, no paragraph numbering/citation at all) instead of reusing the
-- unused `laws`/`law_sections` tables from migration 0001, whose per-section/valid_from-valid_to
-- shape is for a different use case (browsing a statute's individual numbered sections) than the
-- "upload a document, get an organized brief" flow this mirrors from rulings.

create table public.legislation (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  document_id uuid references public.documents(id),
  full_text text,
  brief_status text not null default 'none' check (brief_status in ('none','ai','reviewed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.legislation_briefs (
  id uuid primary key default gen_random_uuid(),
  legislation_id uuid not null references public.legislation(id) on delete cascade,
  sections jsonb,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_legislation (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  legislation_id uuid not null references public.legislation(id) on delete cascade,
  unique (course_id, legislation_id)
);

do $$
declare t text;
begin
  foreach t in array array['legislation', 'legislation_briefs'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['legislation', 'legislation_briefs', 'course_legislation'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('create policy %I_select_active on public.%I for select using (public.is_active());', t, t);
    execute format('create policy %I_admin_write on public.%I for insert with check (public.is_admin());', t, t);
    execute format('create policy %I_admin_update on public.%I for update using (public.is_admin()) with check (public.is_admin());', t, t);
    execute format('create policy %I_admin_delete on public.%I for delete using (public.is_admin());', t, t);
  end loop;
end $$;
