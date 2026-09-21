# אסמכתא (Asmachta)

A Hebrew, right-to-left law-study portal for Israeli law students: course
libraries, AI-assisted summaries and case-law digests, spaced-repetition
practice, and a shared/moderated content area — built as a single-page
React app on Supabase.

This README covers the foundation (M1): auth, roles, courses, and the app
shell/design system. Content features (summaries, case-law digests, the AI
tutor, practice, and the shared area) come in later milestones and aren't
built yet.

## Stack

- **React 19 + TypeScript (strict) + Vite**
- **Tailwind CSS v4** — CSS-first `@theme` config in `src/index.css`, no
  `tailwind.config.js`. Light/dark and two visual directions ("ספרייה" /
  "סטודיו") are runtime CSS custom properties toggled via classes on
  `<html>` (see `src/app/theme.ts`).
- **Supabase** — Postgres + Row Level Security, Auth (email/password +
  Google OAuth), Storage (planned).
- **react-router-dom v7**, **@dnd-kit** (drag-to-reorder), **@testing-library/react** + **Vitest** (unit), **Playwright** (e2e).
- **Netlify** for hosting (`netlify.toml`: SPA redirect + build command).

## Getting started

```bash
npm install
cp .env.example .env   # fill in the two variables below
npm run dev
```

### Environment variables

| Variable | Where to get it | Required for |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project → Settings → API → Project URL | everything — the app throws on load without it |
| `VITE_SUPABASE_ANON_KEY` | Supabase project → Settings → API → Project API keys → `anon` `public` key | everything |

These are read at build time by Vite (`import.meta.env.*`) and consumed in
`src/lib/supabase.ts`. **They must also be set as environment variables on
Netlify** (Site configuration → Environment variables, scopes: *Builds* and
*Runtime*) — a deploy without them builds successfully but renders a blank
page, because `createClient()` throws before React ever renders.

Google sign-in additionally needs, outside this repo:
1. An OAuth Client ID in Google Cloud Console (Authorized JS origins: your
   deployed URL and `http://localhost:5173`; Authorized redirect URI:
   `<your-supabase-project>.supabase.co/auth/v1/callback`).
2. That Client ID/Secret pasted into Supabase Dashboard → Authentication →
   Providers → Google, enabled.

The sign-in button ships regardless and simply errors if these aren't
configured yet.

### Database

`supabase/migrations/0001_init.sql` has the full schema: tables, Row Level
Security policies, and the `handle_new_user()` trigger (first-ever signup
becomes an active admin; later signups become `pending` or `active`
depending on `app_settings.require_signup_approval`, editable from
`/admin` → Settings). Apply it to a fresh Supabase project via the
Supabase CLI or the SQL editor.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) then production build |
| `npm run preview` | Preview a production build locally |
| `npm run lint` | Oxlint (React/TypeScript rules) |
| `npm run test` | Unit tests (Vitest + Testing Library), single run |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run e2e` | Playwright end-to-end tests (`tests/e2e/`) — starts its own dev server |
| `npm run screenshots` | Captures the sign-in/sign-up screens in light + dark mode to `screenshots/` for quick visual QA |

`npm run e2e` and `npm run screenshots` currently only cover the
unauthenticated screens — there's no seeded test account yet, so
courses/admin/design aren't exercised by either. Worth adding once a
fixture login exists.

## Project structure

```
src/
  app/            Shell (nav/breadcrumb/user menu), AuthContext, theme.ts
  components/
    ui/           Design system primitives — Button, Select, Dialog, Sheet,
                   Toast, Stepper, TreeRow, Tooltip, Popover, CitationChip…
                   (see them live at /design, admin-only)
    search/       ⌘K command palette
    agent/        Agent panel shell (no AI wired up yet — see below)
  features/
    auth/         Sign in/up, Google OAuth, password reset, pending screen
    home/         Landing/dashboard
    courses/      Course list + course detail (4-tab shell)
    admin/        Users / Courses / Settings management (admin-only)
    design/       /design showcase page
  i18n/he.ts      All UI strings (Hebrew; single source, no i18n library)
  lib/supabase.ts Supabase client + shared types
supabase/migrations/  SQL schema, RLS policies, triggers
tests/unit/       Vitest + Testing Library
tests/e2e/        Playwright
scripts/          screenshots.mjs
```

## Design notes worth knowing

- **RTL**: `<html lang="he" dir="rtl">` is set once in `index.html`.
  Components use logical Tailwind utilities (`ms-`/`me-`, `start-`/`end-`,
  `border-s`/`border-e`) instead of `ml-`/`mr-`/`left-`/`right-`, so the
  layout stays correct under the single RTL direction this app ships in.
  Embedded Latin/numeric runs (citations, case numbers) go through the
  `<Num>` wrapper (`components/ui/Primitives.tsx`) for bidi isolation.
- **Theming**: `src/app/theme.ts` applies the stored theme/direction on
  *every* screen (including sign-in, before `Shell` ever mounts) and
  tracks live OS dark-mode changes. `Shell` owns the actual toggle
  controls, in the user-menu popover.
- **Agent panel**: `components/agent/AgentPanelContext.tsx` provides a
  single global panel any screen can open via `useAgentPanel()`. It has no
  AI wiring yet — that depends on an AI API key and on there being real
  content to answer from, both later milestones — so it currently shows an
  honest "coming soon" placeholder rather than a non-functional chat box.

## Deploying

Netlify is configured via `netlify.toml` (build command `npm run build`,
publish `dist`, SPA redirect to `index.html`). Set the two Supabase env
vars on the Netlify site before the first deploy (see above).
