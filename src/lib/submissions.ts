import { addExternalDocument } from './upload'
import { supabase, type SubmissionFlag, type SubmissionStatus, type SubmissionType, type SubmissionWithProfiles } from './supabase'

const SELECT_WITH_PROFILES =
  '*, uploader:profiles!submissions_uploader_id_fkey(display_name), decider:profiles!submissions_decided_by_fkey(display_name)'

/** Submissions for one course. RLS already does the filtering: admins see everything, everyone
 * else sees their own submissions (any status) plus other members' approved/merged ones — so this
 * single query returns exactly the right rows for whoever is asking. */
export async function fetchCourseSubmissions(courseId: string): Promise<SubmissionWithProfiles[]> {
  const { data, error } = await supabase
    .from('submissions')
    .select(SELECT_WITH_PROFILES)
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as unknown as SubmissionWithProfiles[]) ?? []
}

/** Admin-only moderation queue: every pending submission across all courses. */
export async function fetchPendingSubmissions(): Promise<(SubmissionWithProfiles & { courses: { title: string } | null })[]> {
  const { data, error } = await supabase
    .from('submissions')
    .select(`${SELECT_WITH_PROFILES}, courses(title)`)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as unknown as (SubmissionWithProfiles & { courses: { title: string } | null })[]) ?? []
}

export async function createSubmission(params: {
  courseId: string
  uploaderId: string
  type: SubmissionType
  title: string
  bodyHtml: string
  topicId?: string | null
  rightsDeclared: boolean
}): Promise<void> {
  const { error } = await supabase.from('submissions').insert({
    course_id: params.courseId,
    uploader_id: params.uploaderId,
    type: params.type,
    title: params.title,
    body_html: params.bodyHtml,
    topic_id: params.topicId ?? null,
    rights_declared: params.rightsDeclared,
  })
  if (error) throw error
}

/** Attaches a Google Docs link as the submission's source instead of typed text — registers it as a
 * `documents` row (no file storage involved, per the decision to keep community uploads off the
 * uploads bucket) and creates the submission pointing at it. `body_html` starts empty; the caller
 * should follow up with `extractSubmissionText` to fill it in from the doc's text. */
export async function createLinkSubmission(params: {
  courseId: string
  uploaderId: string
  type: SubmissionType
  title: string
  googleDocsUrl: string
  topicId?: string | null
  rightsDeclared: boolean
}): Promise<{ submissionId: string }> {
  const { documentId } = await addExternalDocument(params.googleDocsUrl, {
    kind: 'other',
    ownerId: params.uploaderId,
    title: params.title,
    visibility: 'shared',
  })
  const { data, error } = await supabase
    .from('submissions')
    .insert({
      course_id: params.courseId,
      uploader_id: params.uploaderId,
      type: params.type,
      title: params.title,
      body_html: null,
      document_id: documentId,
      topic_id: params.topicId ?? null,
      rights_declared: params.rightsDeclared,
    })
    .select('id')
    .single()
  if (error) throw error
  return { submissionId: (data as { id: string }).id }
}

/** Fetches a linked Google Doc's text server-side (browsers can't due to CORS) and writes it into
 * the submission's `body_html`. Also the "reorganize"/retry mechanism for a link submission whose
 * first extraction failed or was never run — same call, just re-invoked. Own submissions only,
 * unless called by an admin. */
export async function extractSubmissionText(submissionId: string): Promise<{ length: number } | { error: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('extract-submission-text', {
    body: { submissionId },
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  })
  if (error) {
    const context = (error as { context?: Response }).context
    const code = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null
    return { error: (code as { error?: string } | null)?.error ?? 'upstream_error' }
  }
  return data as { length: number }
}

/** Every "report a mistake" note filed against submissions in a course, newest first — the uploader
 * and admins can each see notes on their own/any content (RLS: submission_flags_select). Fetched
 * per-course (not per-submission) so a folder/reader view can show counts without N+1 queries. */
export async function fetchFlagsForCourse(courseId: string): Promise<SubmissionFlag[]> {
  const { data, error } = await supabase
    .from('submission_flags')
    .select('*, flagger:profiles!submission_flags_flagged_by_fkey(display_name), submissions!inner(course_id)')
    .eq('submissions.course_id', courseId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as unknown as SubmissionFlag[]) ?? []
}

/** Sends a "there's a mistake in this" note to a submission's uploader + admins. */
export async function flagSubmission(submissionId: string, flaggedBy: string, note: string): Promise<void> {
  const { error } = await supabase.from('submission_flags').insert({ submission_id: submissionId, flagged_by: flaggedBy, note })
  if (error) throw error
}

/** Admin decision: approve or reject a pending submission (a reason is expected for a rejection). */
export async function decideSubmission(
  submissionId: string,
  decidedBy: string,
  status: Extract<SubmissionStatus, 'approved' | 'rejected'>,
  reason: string | null
): Promise<void> {
  const { error } = await supabase
    .from('submissions')
    .update({ status, decision_reason: reason, decided_by: decidedBy, decided_at: new Date().toISOString() })
    .eq('id', submissionId)
  if (error) throw error
}

export async function deleteSubmission(submissionId: string): Promise<void> {
  const { error } = await supabase.from('submissions').delete().eq('id', submissionId)
  if (error) throw error
}
