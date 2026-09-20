-- אסמכתא — full initial schema (M1). All tables from SPEC.md §5 up front.
-- Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

-- ============================================================
-- Helpers
-- ============================================================
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- People & settings
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  role text not null default 'member' check (role in ('admin','member')),
  status text not null default 'pending' check (status in ('pending','active','blocked')),
  agent_daily_quota int not null default 30,
  accepted_privacy_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- is_active()/is_admin() are declared here, right after profiles exists: `language sql` functions
-- are validated against the catalog at CREATE time (unlike plpgsql), so they can't come before it.
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'active');
$$;

create table public.app_settings (
  id boolean primary key default true check (id),
  require_signup_approval boolean not null default true,
  app_name text not null default 'אסמכתא'
);
insert into public.app_settings (id) values (true);

-- First person to ever sign up becomes the active admin automatically (single-admin product).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select not exists(select 1 from public.profiles) into is_first;
  insert into public.profiles (id, display_name, role, status, accepted_privacy_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
    case when is_first then 'admin' else 'member' end,
    case when is_first then 'active' else 'pending' end,
    now()
  );
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- A non-admin can never change their own role/status/quota.
create or replace function public.prevent_role_self_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.id = auth.uid() and not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
    new.agent_daily_quota := old.agent_daily_quota;
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.prevent_role_self_escalation();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select using (auth.uid() is not null);
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on public.profiles for all using (public.is_admin()) with check (public.is_admin());

alter table public.app_settings enable row level security;
create policy app_settings_select on public.app_settings for select using (auth.uid() is not null);
create policy app_settings_admin_write on public.app_settings for update using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- Courses & topics
-- ============================================================
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  lecturer text,
  institution text,
  year_label text,
  semester text check (semester in ('א','ב','קיץ','שנתי')),
  color text not null default 'green',
  exam_date date,
  archived boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  parent_id uuid references public.topics(id) on delete cascade,
  title text not null,
  position int not null default 0,
  summary_id uuid,
  slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Files (smart storage)
-- ============================================================
create table public.blobs (
  sha256 text primary key,
  bytes bigint not null,
  mime text not null,
  storage_path text not null,
  ref_count int not null default 1,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  blob_sha256 text not null references public.blobs(sha256),
  kind text not null check (kind in ('summary','ruling','law','exam','slides','other')),
  original_filename text,
  owner_id uuid references public.profiles(id),
  visibility text not null default 'private' check (visibility in ('core','shared','private')),
  status text not null default 'pending' check (status in ('approved','pending','rejected')),
  rights_status text not null default 'unknown' check (rights_status in ('public_domain','own_work','licensed','unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Summaries
-- ============================================================
create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  document_id uuid references public.documents(id),
  version int not null default 1,
  title text not null,
  raw_html text,
  outline jsonb,
  status text not null default 'draft' check (status in ('draft','published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.topic_sections (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  summary_id uuid not null references public.summaries(id) on delete cascade,
  position int not null default 0,
  heading text,
  html text,
  source_anchor text,
  ai_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  term text not null,
  topic_section_id uuid references public.topic_sections(id) on delete set null,
  normalized text,
  created_at timestamptz not null default now()
);

alter table public.topics add constraint topics_summary_fk foreign key (summary_id) references public.summaries(id) on delete set null;

-- ============================================================
-- Rulings
-- ============================================================
create table public.rulings (
  id uuid primary key default gen_random_uuid(),
  case_type text,
  case_number text,
  case_key text unique,
  joined_cases text[] default '{}',
  title text,
  short_name text,
  aliases text[] default '{}',
  court text,
  decision_date date,
  judges text[] default '{}',
  parties jsonb,
  status text not null default 'unknown' check (status in ('in_force','further_hearing','overturned','unknown')),
  document_id uuid references public.documents(id),
  brief_status text not null default 'none' check (brief_status in ('none','ai','reviewed')),
  citation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ruling_opinions (
  id uuid primary key default gen_random_uuid(),
  ruling_id uuid not null references public.rulings(id) on delete cascade,
  position int not null default 0,
  judge text,
  role text check (role in ('lead','concurring','dissent','partial','unknown')),
  first_paragraph int,
  last_paragraph int
);

create table public.ruling_paragraphs (
  id uuid primary key default gen_random_uuid(),
  ruling_id uuid not null references public.rulings(id) on delete cascade,
  opinion_id uuid references public.ruling_opinions(id) on delete cascade,
  n int not null,
  seq int not null,
  text text not null,
  page int
);

create table public.ruling_briefs (
  id uuid primary key default gen_random_uuid(),
  ruling_id uuid not null references public.rulings(id) on delete cascade,
  sections jsonb,
  validator jsonb,
  model text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  ruling_id uuid not null references public.rulings(id) on delete cascade,
  paragraph_id uuid references public.ruling_paragraphs(id) on delete cascade,
  kind text check (kind in ('holding','important','exam')),
  note text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.course_rulings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  ruling_id uuid not null references public.rulings(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  note text,
  unique (course_id, ruling_id)
);

-- ============================================================
-- Legislation
-- ============================================================
create table public.laws (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text check (kind in ('basic_law','law','ordinance','regulation')),
  aliases text[] default '{}'
);

create table public.law_sections (
  id uuid primary key default gen_random_uuid(),
  law_id uuid not null references public.laws(id) on delete cascade,
  number text not null,
  heading text,
  text text,
  valid_from date,
  valid_to date
);

create table public.course_law_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  law_section_id uuid not null references public.law_sections(id) on delete cascade,
  important boolean not null default false,
  note text,
  unique (course_id, law_section_id)
);

-- ============================================================
-- Links & graph
-- ============================================================
create table public.mentions (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('topic_section','ruling_paragraph','submission')),
  source_id uuid not null,
  target_type text check (target_type in ('ruling','law','law_section','missing')),
  target_id uuid,
  raw_text text,
  normalized text,
  confidence numeric,
  created_at timestamptz not null default now()
);

create table public.missing_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  kind text check (kind in ('ruling','law_section')),
  label text,
  normalized text,
  first_seen_in uuid,
  resolved_at timestamptz
);

create table public.citation_edges (
  id uuid primary key default gen_random_uuid(),
  from_ruling_id uuid not null references public.rulings(id) on delete cascade,
  to_ruling_id uuid not null references public.rulings(id) on delete cascade,
  relation text check (relation in ('cites','overturns','distinguishes','follows'))
);

-- ============================================================
-- Practice
-- ============================================================
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  source_type text,
  source_id uuid,
  front text not null,
  back text not null,
  origin text check (origin in ('ai','admin','term','annotation')),
  status text not null default 'draft' check (status in ('approved','draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.card_states (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  due timestamptz,
  stability numeric,
  difficulty numeric,
  elapsed_days int,
  scheduled_days int,
  reps int not null default 0,
  lapses int not null default 0,
  state text,
  last_review timestamptz,
  primary key (user_id, card_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  rating int,
  reviewed_at timestamptz not null default now(),
  elapsed_ms int
);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  title text,
  created_at timestamptz not null default now()
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  type text check (type in ('mcq','short')),
  stem text not null,
  options jsonb,
  answer text,
  explanation text,
  citations jsonb
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  answers jsonb,
  score numeric,
  started_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  document_id uuid references public.documents(id),
  title text,
  year int,
  solution_document_id uuid references public.documents(id),
  rubric jsonb
);

create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  answer_html text,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  feedback jsonb
);

-- ============================================================
-- Shared area
-- ============================================================
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  type text check (type in ('summary','note','question','ruling')),
  title text not null,
  body_html text,
  document_id uuid references public.documents(id),
  rights_declared boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','merged','rejected','removed')),
  check_result jsonb,
  decision_reason text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  merged_into jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.force_submission_pending() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.status := 'pending';
    new.decided_by := null;
    new.decided_at := null;
    new.decision_reason := null;
    new.merged_into := null;
  end if;
  return new;
end;
$$;
create trigger submissions_force_pending before insert on public.submissions
  for each row execute function public.force_submission_pending();
create trigger submissions_set_updated_at before update on public.submissions
  for each row execute function public.set_updated_at();

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Personal layer
-- ============================================================
create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  range jsonb,
  color text,
  note text,
  created_at timestamptz not null default now()
);

create table public.reading_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  position jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

-- ============================================================
-- AI & search
-- ============================================================
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('topic_section','ruling_paragraph','law_section','submission')),
  source_id uuid not null,
  course_ids uuid[] default '{}',
  locator jsonb,
  text text not null,
  context text,
  embedding halfvec(1536),
  fts tsvector,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index chunks_embedding_hnsw on public.chunks using hnsw (embedding halfvec_cosine_ops);
create index chunks_fts_gin on public.chunks using gin (fts);
create index chunks_text_trgm on public.chunks using gin (text gin_trgm_ops);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text check (role in ('user','assistant','system')),
  content text,
  citations jsonb,
  mode text,
  context jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  function text,
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric,
  latency_ms int,
  ok boolean,
  error text,
  created_at timestamptz not null default now()
);

create table public.eval_questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete cascade,
  question text not null,
  expected_citations jsonb
);

create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.eval_questions(id) on delete cascade,
  answer text,
  citation_accuracy numeric,
  passed boolean,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Operations
-- ============================================================
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text check (type in ('summary_import','ruling_import','ocr','brief','embed','cards','precheck')),
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  stage text,
  progress int not null default 0,
  payload jsonb,
  result jsonb,
  error_code text,
  error_message_he text,
  attempts int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter publication supabase_realtime add table public.jobs;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text,
  title text,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text,
  entity_type text,
  entity_id uuid,
  diff jsonb,
  at timestamptz not null default now()
);

-- ============================================================
-- updated_at triggers for the rest of the tables that have the column
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['courses','topics','documents','summaries','topic_sections','rulings',
    'ruling_briefs','cards','jobs'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- ============================================================
-- RLS: enable everywhere
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['courses','topics','blobs','documents','summaries','topic_sections','terms',
    'rulings','ruling_opinions','ruling_paragraphs','ruling_briefs','annotations','course_rulings',
    'laws','law_sections','course_law_sections','mentions','missing_items','citation_edges',
    'cards','card_states','reviews','quizzes','quiz_questions','quiz_attempts','exams','exam_attempts',
    'submissions','reports','highlights','reading_progress','chunks','conversations','messages',
    'ai_calls','eval_questions','eval_runs','jobs','notifications','audit_log'] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Group A: core content, admin writes / active members read everything (drafts hidden at UI level for now;
-- tightened per-status in M2/M3 when those screens exist).
do $$
declare t text;
begin
  foreach t in array array['courses','topics','laws','law_sections','course_law_sections',
    'rulings','ruling_opinions','ruling_paragraphs','ruling_briefs','annotations','course_rulings',
    'mentions','missing_items','citation_edges','cards','quizzes','quiz_questions','exams'] loop
    execute format('create policy %I_select_active on public.%I for select using (public.is_active());', t, t);
    execute format('create policy %I_admin_write on public.%I for insert with check (public.is_admin());', t, t);
    execute format('create policy %I_admin_update on public.%I for update using (public.is_admin()) with check (public.is_admin());', t, t);
    execute format('create policy %I_admin_delete on public.%I for delete using (public.is_admin());', t, t);
  end loop;
end $$;

-- Group A2: summaries / topic_sections / terms — members see published only, admin sees + writes all.
create policy summaries_select_published on public.summaries for select using (status = 'published' and public.is_active());
create policy summaries_admin_select on public.summaries for select using (public.is_admin());
create policy summaries_admin_write on public.summaries for insert with check (public.is_admin());
create policy summaries_admin_update on public.summaries for update using (public.is_admin()) with check (public.is_admin());
create policy summaries_admin_delete on public.summaries for delete using (public.is_admin());

create policy topic_sections_select on public.topic_sections for select using (
  public.is_active() and exists (select 1 from public.summaries s where s.id = summary_id and (s.status = 'published' or public.is_admin()))
);
create policy topic_sections_admin_write on public.topic_sections for insert with check (public.is_admin());
create policy topic_sections_admin_update on public.topic_sections for update using (public.is_admin()) with check (public.is_admin());
create policy topic_sections_admin_delete on public.topic_sections for delete using (public.is_admin());

create policy terms_select on public.terms for select using (public.is_active());
create policy terms_admin_write on public.terms for insert with check (public.is_admin());
create policy terms_admin_update on public.terms for update using (public.is_admin()) with check (public.is_admin());
create policy terms_admin_delete on public.terms for delete using (public.is_admin());

-- Documents: owner or core+approved visible to active members; admin sees all.
create policy documents_select on public.documents for select using (
  public.is_admin() or owner_id = auth.uid() or (visibility = 'core' and status = 'approved' and public.is_active())
);
create policy documents_insert on public.documents for insert with check (public.is_active() and owner_id = auth.uid());
create policy documents_admin_update on public.documents for update using (public.is_admin()) with check (public.is_admin());
create policy documents_admin_delete on public.documents for delete using (public.is_admin());

-- Blobs: internal, admin/service only.
create policy blobs_admin_all on public.blobs for all using (public.is_admin()) with check (public.is_admin());

-- chunks: members read approved only; only admin/service role writes.
create policy chunks_select_approved on public.chunks for select using (approved = true and public.is_active());
create policy chunks_admin_write on public.chunks for all using (public.is_admin()) with check (public.is_admin());

-- Group B: personal, owner-only tables.
do $$
declare t text;
begin
  foreach t in array array['card_states','reviews','quiz_attempts','exam_attempts','highlights',
    'reading_progress','conversations','notifications'] loop
    execute format('create policy %I_owner_select on public.%I for select using (user_id = auth.uid());', t, t);
    execute format('create policy %I_owner_insert on public.%I for insert with check (user_id = auth.uid());', t, t);
    execute format('create policy %I_owner_update on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid());', t, t);
    execute format('create policy %I_owner_delete on public.%I for delete using (user_id = auth.uid());', t, t);
  end loop;
end $$;
-- messages belong to a conversation, not directly a user — checked via join instead.
create policy messages_owner_select on public.messages for select using (
  exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
);
create policy messages_owner_insert on public.messages for insert with check (
  exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
);

-- Submissions: member inserts own (forced pending by trigger); selects own + approved/merged; admin all.
create policy submissions_insert on public.submissions for insert with check (public.is_active() and uploader_id = auth.uid());
create policy submissions_select on public.submissions for select using (
  public.is_admin() or uploader_id = auth.uid() or status in ('approved','merged')
);
create policy submissions_admin_update on public.submissions for update using (public.is_admin()) with check (public.is_admin());
create policy submissions_admin_delete on public.submissions for delete using (public.is_admin());

create policy reports_insert on public.reports for insert with check (public.is_active() and reporter_id = auth.uid());
create policy reports_select on public.reports for select using (public.is_admin() or reporter_id = auth.uid());
create policy reports_admin_update on public.reports for update using (public.is_admin()) with check (public.is_admin());

-- Operational tables: admin (+ owner for jobs/created_by, so realtime progress works for the uploader).
create policy jobs_select on public.jobs for select using (public.is_admin() or created_by = auth.uid());
create policy jobs_insert on public.jobs for insert with check (public.is_active());
create policy jobs_admin_update on public.jobs for update using (public.is_admin()) with check (public.is_admin());

create policy ai_calls_admin_all on public.ai_calls for all using (public.is_admin()) with check (public.is_admin());
create policy eval_questions_admin_all on public.eval_questions for all using (public.is_admin()) with check (public.is_admin());
create policy eval_runs_admin_all on public.eval_runs for all using (public.is_admin()) with check (public.is_admin());
create policy audit_log_admin_all on public.audit_log for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- Storage bucket (private; signed URLs issued by Edge Functions later)
-- ============================================================
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false)
  on conflict (id) do nothing;
create policy uploads_admin_all on storage.objects for all
  using (bucket_id = 'uploads' and public.is_admin())
  with check (bucket_id = 'uploads' and public.is_admin());

-- ============================================================
-- Dev seed: 3 courses (clearly fake, no fake users — the first real signup becomes admin)
-- ============================================================
insert into public.courses (title, lecturer, institution, year_label, semester, color, position) values
  ('משפט חוקתי', 'ד״ר בן ציון להב', 'הדוגמה למשפטים', 'שנה ב׳', 'א', 'green', 1),
  ('דיני חוזים', 'פרופ׳ (לדוגמה)', 'הדוגמה למשפטים', 'שנה א׳', 'ב', 'gold', 2),
  ('דיני עונשין', 'פרופ׳ (לדוגמה)', 'הדוגמה למשפטים', 'שנה ב׳', 'שנתי', 'green', 3);
