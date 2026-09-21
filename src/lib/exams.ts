import { supabase, type ExamAttemptRow, type ExamFeedback, type ExamRubric, type ExamWithFile } from './supabase'

export async function fetchExams(courseId: string): Promise<ExamWithFile[]> {
  const { data, error } = await supabase
    .from('exams')
    .select('*, documents(*, blobs(*))')
    .eq('course_id', courseId)
    .order('year', { ascending: false, nullsFirst: false })
  if (error) throw error
  return (data as ExamWithFile[] | null) ?? []
}

export async function createExam(params: {
  courseId: string
  title: string
  year: number | null
  documentId: string | null
  rubricText: string
  durationMinutes: number | null
}): Promise<void> {
  const rubric: ExamRubric = { text: params.rubricText }
  if (params.durationMinutes) rubric.durationMinutes = params.durationMinutes
  const { error } = await supabase.from('exams').insert({
    course_id: params.courseId,
    title: params.title,
    year: params.year,
    document_id: params.documentId,
    rubric,
  })
  if (error) throw error
}

export async function deleteExam(examId: string): Promise<void> {
  const { error } = await supabase.from('exams').delete().eq('id', examId)
  if (error) throw error
}

/** A student's attempts across a course's exams, newest first, joined with the exam's title/year. */
export async function fetchMyAttempts(
  courseId: string,
  userId: string
): Promise<(ExamAttemptRow & { exams: { title: string | null; year: number | null } | null })[]> {
  const { data, error } = await supabase
    .from('exam_attempts')
    .select('*, exams!inner(title, year, course_id)')
    .eq('user_id', userId)
    .eq('exams.course_id', courseId)
    .order('started_at', { ascending: false })
  if (error) throw error
  return (data as unknown as (ExamAttemptRow & { exams: { title: string | null; year: number | null } | null })[]) ?? []
}

export async function startAttempt(examId: string, userId: string): Promise<string> {
  const { data, error } = await supabase.from('exam_attempts').insert({ exam_id: examId, user_id: userId }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function submitAttempt(attemptId: string, answerHtml: string): Promise<void> {
  const { error } = await supabase
    .from('exam_attempts')
    .update({ answer_html: answerHtml, submitted_at: new Date().toISOString() })
    .eq('id', attemptId)
  if (error) throw error
}

/** Kicks off AI grading of a submitted attempt against its exam's rubric. */
export async function gradeAttempt(attemptId: string): Promise<ExamFeedback | { error: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('grade-exam-attempt', {
    body: { attemptId },
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  })
  if (error) {
    const context = (error as { context?: Response }).context
    const code = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null
    return { error: (code as { error?: string } | null)?.error ?? 'upstream_error' }
  }
  return data as ExamFeedback
}
