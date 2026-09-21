import { supabase, type CardRow, type CardState, type QuizQuestionRow, type QuizWithQuestions } from './supabase'

// ============================================================
// Flashcards
// ============================================================

export async function fetchCards(courseId: string): Promise<CardRow[]> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as CardRow[]) ?? []
}

export async function fetchCardStates(userId: string, cardIds: string[]): Promise<Record<string, CardState>> {
  if (cardIds.length === 0) return {}
  const { data, error } = await supabase.from('card_states').select('*').eq('user_id', userId).in('card_id', cardIds)
  if (error) throw error
  const map: Record<string, CardState> = {}
  for (const row of (data as CardState[]) ?? []) map[row.card_id] = row
  return map
}

export async function createCard(courseId: string, front: string, back: string): Promise<void> {
  const { error } = await supabase.from('cards').insert({ course_id: courseId, front, back, origin: 'admin', status: 'approved' })
  if (error) throw error
}

export async function updateCard(id: string, front: string, back: string): Promise<void> {
  const { error } = await supabase.from('cards').update({ front, back }).eq('id', id)
  if (error) throw error
}

export async function deleteCard(id: string): Promise<void> {
  const { error } = await supabase.from('cards').delete().eq('id', id)
  if (error) throw error
}

export type Rating = 'again' | 'good'

/**
 * Simplified spaced-repetition scheduler (loosely SM-2 style). The DB columns (`stability`,
 * `difficulty`, `elapsed_days`…) were laid out for a full FSRS implementation later; this is a
 * deliberately simple stand-in that still gives a real "due today" study queue.
 */
function nextSchedule(current: Pick<CardState, 'reps' | 'scheduled_days'> | undefined, rating: Rating) {
  if (rating === 'again') {
    return {
      reps: 0,
      scheduled_days: 0,
      state: 'learning' as const,
      due: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }
  }
  const prevDays = current?.scheduled_days ?? 0
  const reps = (current?.reps ?? 0) + 1
  const days = reps <= 1 ? 1 : reps === 2 ? 3 : Math.round(prevDays * 2.3)
  return {
    reps,
    scheduled_days: days,
    state: 'review' as const,
    due: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
  }
}

export async function rateCard(userId: string, cardId: string, current: CardState | undefined, rating: Rating): Promise<void> {
  const next = nextSchedule(current, rating)
  const { error: stateError } = await supabase.from('card_states').upsert({
    user_id: userId,
    card_id: cardId,
    due: next.due,
    scheduled_days: next.scheduled_days,
    reps: next.reps,
    lapses: (current?.lapses ?? 0) + (rating === 'again' ? 1 : 0),
    state: next.state,
    last_review: new Date().toISOString(),
  })
  if (stateError) throw stateError
  const { error: reviewError } = await supabase
    .from('reviews')
    .insert({ user_id: userId, card_id: cardId, rating: rating === 'good' ? 3 : 1 })
  if (reviewError) throw reviewError
}

// ============================================================
// Quizzes
// ============================================================

export async function fetchQuizzes(courseId: string): Promise<QuizWithQuestions[]> {
  const { data, error } = await supabase
    .from('quizzes')
    .select('*, quiz_questions(*)')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as QuizWithQuestions[]) ?? []
}

export async function createQuiz(courseId: string, title: string): Promise<string> {
  const { data, error } = await supabase.from('quizzes').insert({ course_id: courseId, title }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function deleteQuiz(id: string): Promise<void> {
  const { error } = await supabase.from('quizzes').delete().eq('id', id)
  if (error) throw error
}

export async function addQuestion(
  quizId: string,
  q: { stem: string; options: string[]; answer: string; explanation?: string }
): Promise<void> {
  const { error } = await supabase.from('quiz_questions').insert({
    quiz_id: quizId,
    type: 'mcq',
    stem: q.stem,
    options: q.options,
    answer: q.answer,
    explanation: q.explanation ?? null,
  })
  if (error) throw error
}

export async function deleteQuestion(id: string): Promise<void> {
  const { error } = await supabase.from('quiz_questions').delete().eq('id', id)
  if (error) throw error
}

export function scoreAttempt(questions: QuizQuestionRow[], answers: Record<string, string>): number {
  if (questions.length === 0) return 0
  const correct = questions.filter((q) => answers[q.id] && q.answer && answers[q.id] === q.answer).length
  return Math.round((correct / questions.length) * 100)
}

export async function submitQuizAttempt(
  userId: string,
  quizId: string,
  answers: Record<string, string>,
  score: number
): Promise<void> {
  const { error } = await supabase.from('quiz_attempts').insert({
    user_id: userId,
    quiz_id: quizId,
    answers,
    score,
    submitted_at: new Date().toISOString(),
  })
  if (error) throw error
}

// ============================================================
// AI-assisted suggestions
// ============================================================

export type CardSuggestion = { front: string; back: string }
export type QuestionSuggestion = { stem: string; options: string[]; answer: string; explanation?: string }

async function callGeneratePractice<T>(body: Record<string, unknown>): Promise<T[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('generate-practice', {
    body,
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  })
  if (error) throw error
  const items = (data as { items?: T[] } | null)?.items
  if (!Array.isArray(items)) throw new Error('bad_response')
  return items
}

export async function suggestCards(courseId: string, courseTitle: string, count: number): Promise<CardSuggestion[]> {
  return callGeneratePractice<CardSuggestion>({ courseId, courseTitle, mode: 'cards', count })
}

export async function suggestQuestions(courseId: string, courseTitle: string, count: number): Promise<QuestionSuggestion[]> {
  return callGeneratePractice<QuestionSuggestion>({ courseId, courseTitle, mode: 'quiz', count })
}
