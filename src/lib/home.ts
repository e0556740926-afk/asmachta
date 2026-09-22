import { supabase } from './supabase'

// ------------------------------------------------------------
// Home page data — all real, computed from tables the rest of the app already
// writes to (reading_progress, card_states, submissions) rather than any
// placeholder numbers.
// ------------------------------------------------------------

export type ContinueItem = {
  topicId: string
  topicTitle: string
  courseId: string
  courseTitle: string
  updatedAt: string
}

/** The most recently opened topic for this user, with its course — powers the
 * "continue where you left off" card. Two lightweight lookups because
 * `reading_progress.target_id` is a generic polymorphic column (also used for
 * rulings etc.), so PostgREST can't embed it directly as a foreign key. */
export async function fetchContinueReading(userId: string): Promise<ContinueItem | null> {
  const { data: progress } = await supabase
    .from('reading_progress')
    .select('target_id, updated_at')
    .eq('user_id', userId)
    .eq('target_type', 'topic')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!progress) return null

  const { data: topic } = await supabase
    .from('topics')
    .select('id, title, course_id, courses(title)')
    .eq('id', progress.target_id)
    .maybeSingle()
  if (!topic) return null
  const courseTitle = (topic as unknown as { courses: { title: string } | null }).courses?.title ?? ''

  return {
    topicId: topic.id as string,
    topicTitle: topic.title as string,
    courseId: topic.course_id as string,
    courseTitle,
    updatedAt: progress.updated_at as string,
  }
}

export type HomeStats = { topicsViewed: number; topicsTotal: number; cardsDue: number }

/** Real counters, not the mockup's fixed numbers: distinct topics this user has opened (out of
 * all topics in active courses), and cards currently due for review (per the same `card_states`
 * table CardsPanel already reads). */
export async function fetchHomeStats(userId: string): Promise<HomeStats> {
  const nowIso = new Date().toISOString()
  const [topicsTotalRes, progressRes, cardsDueRes] = await Promise.all([
    supabase
      .from('topics')
      .select('id, courses!inner(archived)', { count: 'exact', head: true })
      .eq('courses.archived', false),
    supabase.from('reading_progress').select('target_id').eq('user_id', userId).eq('target_type', 'topic'),
    supabase.from('card_states').select('card_id', { count: 'exact', head: true }).eq('user_id', userId).lte('due', nowIso),
  ])
  const topicsViewed = new Set((progressRes.data ?? []).map((r) => r.target_id as string)).size
  return {
    topicsViewed,
    topicsTotal: topicsTotalRes.count ?? 0,
    cardsDue: cardsDueRes.count ?? 0,
  }
}

export type ActivityItem = {
  id: string
  title: string
  type: string
  courseId: string
  courseTitle: string
  uploaderName: string | null
  createdAt: string
}

/** Recent approved community shares across all courses — the real analogue of the mockup's
 * fabricated activity feed. */
export async function fetchRecentActivity(limit = 5): Promise<ActivityItem[]> {
  const { data } = await supabase
    .from('submissions')
    .select(
      'id, title, type, created_at, course_id, courses(title), profiles!submissions_uploader_id_fkey(display_name)'
    )
    .in('status', ['approved', 'merged'])
    .order('created_at', { ascending: false })
    .limit(limit)
  type Row = {
    id: string
    title: string
    type: string
    created_at: string
    course_id: string
    courses: { title: string } | null
    profiles: { display_name: string | null } | null
  }
  return ((data as Row[] | null) ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    courseId: r.course_id,
    courseTitle: r.courses?.title ?? '',
    uploaderName: r.profiles?.display_name ?? null,
    createdAt: r.created_at,
  }))
}

export type LearningPulse = {
  /** Review counts for the last 7 days, oldest→newest; index 6 is today. */
  dailyCounts: number[]
  /** Hebrew day-letter (א/ב/ג/...) for each of the same 7 days. */
  dayLabels: string[]
  activeDays: boolean[]
  /** % of reviews rated "good" in the window, or null when there were none to judge. */
  accuracyPct: number | null
  /** Distinct topics opened in the last 7 days. */
  topicsThisWeek: number
}

const HEBREW_DAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'] // Date#getDay(): 0=Sun..6=Sat

/** Real week-in-review data for the home page's "learning pulse" widget — driven by the
 * `reviews` log (flashcard ratings) and `reading_progress`, not placeholder numbers. */
export async function fetchLearningPulse(userId: string): Promise<LearningPulse> {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const windowStart = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000)

  const [{ data: reviewRows }, { data: progressRows }] = await Promise.all([
    supabase.from('reviews').select('rating, reviewed_at').eq('user_id', userId).gte('reviewed_at', windowStart.toISOString()),
    supabase
      .from('reading_progress')
      .select('target_id')
      .eq('user_id', userId)
      .eq('target_type', 'topic')
      .gte('updated_at', windowStart.toISOString()),
  ])

  const dailyCounts = Array(7).fill(0)
  const dayLabels = Array(7).fill('')
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfToday.getTime() - (6 - i) * 24 * 60 * 60 * 1000)
    dayLabels[i] = HEBREW_DAY_LETTERS[d.getDay()]
  }

  let correct = 0
  let total = 0
  for (const row of reviewRows ?? []) {
    const reviewedAt = new Date(row.reviewed_at as string).getTime()
    const dayIndex = Math.floor((reviewedAt - windowStart.getTime()) / (24 * 60 * 60 * 1000))
    if (dayIndex >= 0 && dayIndex < 7) dailyCounts[dayIndex]++
    total++
    if ((row.rating as number) >= 3) correct++
  }

  return {
    dailyCounts,
    dayLabels,
    activeDays: dailyCounts.map((c) => c > 0),
    accuracyPct: total > 0 ? Math.round((correct / total) * 100) : null,
    topicsThisWeek: new Set((progressRows ?? []).map((r) => r.target_id as string)).size,
  }
}

export type QuickReviewCard = { cardId: string; front: string; courseId: string; courseTitle: string }

/** One due card (earliest-due first) to surface as a quick-review prompt on the home page. */
export async function fetchQuickReviewCard(userId: string): Promise<QuickReviewCard | null> {
  const nowIso = new Date().toISOString()
  const { data: dueStates } = await supabase
    .from('card_states')
    .select('card_id, due')
    .eq('user_id', userId)
    .lte('due', nowIso)
    .order('due', { ascending: true })
    .limit(5)
  if (!dueStates || dueStates.length === 0) return null

  const { data: cards } = await supabase
    .from('cards')
    .select('id, front, course_id, courses(title)')
    .in(
      'id',
      dueStates.map((s) => s.card_id as string)
    )
    .eq('status', 'approved')
    .limit(1)
  if (!cards || cards.length === 0) return null
  const c = cards[0] as unknown as { id: string; front: string; course_id: string; courses: { title: string } | null }
  return { cardId: c.id, front: c.front, courseId: c.course_id, courseTitle: c.courses?.title ?? '' }
}
