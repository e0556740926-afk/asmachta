import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key)

export type Profile = {
  id: string
  display_name: string | null
  avatar_url: string | null
  role: 'admin' | 'member'
  status: 'pending' | 'active' | 'blocked'
  agent_daily_quota: number
}

export type Course = {
  id: string
  title: string
  lecturer: string | null
  institution: string | null
  year_label: string | null
  semester: string | null
  color: string
  exam_date: string | null
  archived: boolean
  position: number
}

export type AppSettings = {
  id: true
  require_signup_approval: boolean
  app_name: string
}

export type DocumentKind = 'summary' | 'ruling' | 'law' | 'exam' | 'slides' | 'other'

export type DocumentRow = {
  id: string
  blob_sha256: string | null
  external_url: string | null
  kind: DocumentKind
  original_filename: string | null
  owner_id: string | null
  visibility: 'core' | 'shared' | 'private'
  status: 'approved' | 'pending' | 'rejected'
  created_at: string
}

export type BlobRow = {
  sha256: string
  bytes: number
  mime: string
  storage_path: string
  ref_count: number
}

export type Summary = {
  id: string
  course_id: string
  document_id: string | null
  version: number
  title: string
  raw_html: string | null
  outline: unknown
  status: 'draft' | 'published'
  created_at: string
  updated_at: string
}

/** A summary joined with its underlying document + blob, as returned by the list query. */
export type SummaryWithFile = Summary & {
  documents: (DocumentRow & { blobs: BlobRow | null }) | null
}

// ============================================================
// Topics: AI-organized, per-course "folders" that summaries get split into
// ============================================================

export type TopicRow = {
  id: string
  course_id: string
  parent_id: string | null
  title: string
  position: number
  slug: string | null
  created_at: string
  updated_at: string
}

export type TopicSectionRow = {
  id: string
  topic_id: string
  summary_id: string
  position: number
  heading: string | null
  html: string | null
  source_anchor: string | null
  ai_reason: string | null
  created_at: string
  updated_at: string
}

/** A topic joined with its ordered sections, as returned by the topics-view query. */
export type TopicWithSections = TopicRow & { topic_sections: TopicSectionRow[] }

export type Ruling = {
  id: string
  case_type: string | null
  case_number: string | null
  title: string | null
  court: string | null
  decision_date: string | null
  status: 'in_force' | 'further_hearing' | 'overturned' | 'unknown'
  document_id: string | null
  brief_status: 'none' | 'ai' | 'reviewed'
  citation: string | null
  created_at: string
}

/** A course_rulings row joined through to its ruling + underlying document + blob. */
export type CourseRulingWithFile = {
  id: string
  course_id: string
  ruling_id: string
  rulings: (Ruling & { documents: (DocumentRow & { blobs: BlobRow | null }) | null }) | null
}

// ============================================================
// Ruling reader: AI brief + citable numbered source paragraphs
// ============================================================

export type RulingParagraphRow = {
  id: string
  ruling_id: string
  opinion_id: string | null
  n: number
  seq: number
  text: string
  page: number | null
}

/** One part of an AI-generated brief (a section of prose that may cite specific paragraph
 * numbers from the ruling's original text) or a short key-point chip that jumps to paragraphs. */
export type BriefPart = { heading: string; content: string; paragraphNumbers: number[] }
export type BriefKeyPoint = { label: string; paragraphNumbers: number[] }
export type BriefSections = { parts: BriefPart[]; keyPoints: BriefKeyPoint[] }

export type RulingBriefRow = {
  id: string
  ruling_id: string
  sections: BriefSections | null
  model: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Legislation: a simpler sibling of rulings — one document, one ordered brief
// (heading + content parts, no paragraph numbering/citation — see migration 0007).
// ============================================================

export type Legislation = {
  id: string
  title: string
  document_id: string | null
  full_text: string | null
  brief_status: 'none' | 'ai' | 'reviewed'
  created_at: string
}

/** A course_legislation row joined through to the legislation item + underlying document + blob. */
export type CourseLegislationWithFile = {
  id: string
  course_id: string
  legislation_id: string
  legislation: (Legislation & { documents: (DocumentRow & { blobs: BlobRow | null }) | null }) | null
}

export type LegislationBriefPart = { heading: string; content: string }

export type LegislationBriefRow = {
  id: string
  legislation_id: string
  sections: { parts: LegislationBriefPart[] } | null
  model: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Practice: flashcards + quizzes
// ============================================================

export type CardRow = {
  id: string
  course_id: string
  topic_id: string | null
  front: string
  back: string
  origin: 'ai' | 'admin' | 'term' | 'annotation' | null
  status: 'approved' | 'draft'
  created_at: string
}

export type CardState = {
  user_id: string
  card_id: string
  due: string | null
  scheduled_days: number | null
  reps: number
  lapses: number
  state: 'new' | 'learning' | 'review' | null
  last_review: string | null
}

/** A card joined with the current user's own review state (null if never studied). */
export type CardWithState = CardRow & { card_states: CardState[] }

export type QuizRow = {
  id: string
  course_id: string
  topic_id: string | null
  title: string | null
  created_at: string
}

export type QuizQuestionOption = string

export type QuizQuestionRow = {
  id: string
  quiz_id: string
  type: 'mcq' | 'short'
  stem: string
  options: QuizQuestionOption[] | null
  answer: string | null
  explanation: string | null
}

export type QuizWithQuestions = QuizRow & { quiz_questions: QuizQuestionRow[] }

export type QuizAttemptRow = {
  id: string
  user_id: string
  quiz_id: string
  answers: Record<string, string> | null
  score: number | null
  started_at: string
  submitted_at: string | null
}

// ============================================================
// Community submissions: members share content, admin approves/rejects
// ============================================================

export type SubmissionType = 'summary' | 'note' | 'question' | 'ruling'
export type SubmissionStatus = 'pending' | 'approved' | 'merged' | 'rejected' | 'removed'

export type SubmissionRow = {
  id: string
  uploader_id: string
  course_id: string
  topic_id: string | null
  type: SubmissionType | null
  title: string
  body_html: string | null
  document_id: string | null
  rights_declared: boolean
  status: SubmissionStatus
  decision_reason: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
}

/** A submission joined with its uploader's display name (and the deciding admin's, when present). */
export type SubmissionWithProfiles = SubmissionRow & {
  uploader: { display_name: string | null } | null
  decider: { display_name: string | null } | null
}

/** A "report a mistake" note filed against a submission — visible to its uploader and admins. */
export type SubmissionFlag = {
  id: string
  submission_id: string
  flagged_by: string
  note: string
  created_at: string
  flagger: { display_name: string | null } | null
}

// ============================================================
// Exam simulator: past exams with an admin-written rubric + AI-graded essay attempts
// ============================================================

/** Stored in `exams.rubric` — grading guidance plus an optional suggested time limit for the
 * simulated session (the schema has no dedicated duration column). */
export type ExamRubric = { text: string; durationMinutes?: number }

export type ExamRow = {
  id: string
  course_id: string
  document_id: string | null
  title: string | null
  year: number | null
  solution_document_id: string | null
  rubric: ExamRubric | null
}

export type ExamWithFile = ExamRow & { documents: (DocumentRow & { blobs: BlobRow | null }) | null }

export type ExamFeedback = {
  score: number
  strengths: string[]
  improvements: string[]
  criteriaFeedback?: { criterion: string; feedback: string }[]
}

export type ExamAttemptRow = {
  id: string
  user_id: string
  exam_id: string
  answer_html: string | null
  started_at: string
  submitted_at: string | null
  feedback: ExamFeedback | null
}
