import { supabase, type SubmissionStatus, type SubmissionType, type SubmissionWithProfiles } from './supabase'

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
