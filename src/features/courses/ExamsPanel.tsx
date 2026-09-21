import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Num, Skeleton, StatusChip } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'
import {
  createExam,
  deleteExam,
  fetchExams,
  fetchMyAttempts,
  gradeAttempt,
  startAttempt,
  submitAttempt,
} from '../../lib/exams'
import type { ExamAttemptRow, ExamFeedback, ExamWithFile } from '../../lib/supabase'
import { getDownloadUrl, uploadDocument } from '../../lib/upload'

function mapGradeError(code: string): string {
  return code === 'upstream_busy' ? t.exams.gradeErrorBusy : t.exams.gradeErrorGeneric
}

/**
 * Exam simulator: admin attaches past exams (optionally with a rubric); a student "starts" an
 * exam (creates an exam_attempts row), writes a free-text answer, submits, and gets AI feedback
 * graded against the rubric — the exams / exam_attempts tables from the original plan, wired up
 * for the first time.
 */
export function ExamsPanel({ courseId }: { courseId: string }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [exams, setExams] = useState<ExamWithFile[] | null>(null)
  const [myAttempts, setMyAttempts] = useState<(ExamAttemptRow & { exams: { title: string | null; year: number | null } | null })[]>([])
  const [error, setError] = useState<string | null>(null)

  // Admin add-exam form
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const [duration, setDuration] = useState('')
  const [rubricText, setRubricText] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  // Active attempt (taking / reviewing)
  const [activeExam, setActiveExam] = useState<ExamWithFile | null>(null)
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [grading, setGrading] = useState(false)
  const [gradeError, setGradeError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ExamFeedback | null>(null)

  async function load() {
    if (!profile) return
    const [examRows, attemptRows] = await Promise.all([fetchExams(courseId), fetchMyAttempts(courseId, profile.id)])
    setExams(examRows)
    setMyAttempts(attemptRows)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, profile?.id])

  async function onCreateExam(e: React.FormEvent) {
    e.preventDefault()
    if (!profile || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      let documentId: string | null = null
      if (pendingFile) {
        const res = await uploadDocument(pendingFile, { kind: 'exam', ownerId: profile.id, visibility: 'core' })
        documentId = res.documentId
      }
      await createExam({
        courseId,
        title: title.trim(),
        year: year ? Number(year) : null,
        documentId,
        rubricText: rubricText.trim(),
        durationMinutes: duration ? Number(duration) : null,
      })
      setTitle('')
      setYear('')
      setDuration('')
      setRubricText('')
      setPendingFile(null)
      setFormOpen(false)
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteExam(examId: string) {
    await deleteExam(examId)
    await load()
  }

  async function onOpenFile(exam: ExamWithFile) {
    const doc = exam.documents
    if (!doc) return
    if (doc.external_url) {
      window.open(doc.external_url, '_blank', 'noopener,noreferrer')
      return
    }
    const path = doc.blobs?.storage_path
    if (!path) return
    try {
      const url = await getDownloadUrl(path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setError(t.course.downloadError)
    }
  }

  async function onStart(exam: ExamWithFile) {
    if (!profile) return
    const attemptId = await startAttempt(exam.id, profile.id)
    setActiveExam(exam)
    setActiveAttemptId(attemptId)
    setAnswer('')
    setFeedback(null)
    setGradeError(null)
  }

  async function onSubmitAnswer() {
    if (!activeAttemptId || !answer.trim()) return
    setSubmitting(true)
    setGradeError(null)
    try {
      await submitAttempt(activeAttemptId, answer.trim())
      setGrading(true)
      const result = await gradeAttempt(activeAttemptId)
      if ('error' in result) setGradeError(mapGradeError(result.error))
      else setFeedback(result)
      await load()
    } catch {
      setGradeError(t.exams.gradeErrorGeneric)
    } finally {
      setSubmitting(false)
      setGrading(false)
    }
  }

  async function onRetryGrading() {
    if (!activeAttemptId) return
    setGrading(true)
    setGradeError(null)
    try {
      const result = await gradeAttempt(activeAttemptId)
      if ('error' in result) setGradeError(mapGradeError(result.error))
      else setFeedback(result)
      await load()
    } finally {
      setGrading(false)
    }
  }

  function onBack() {
    setActiveExam(null)
    setActiveAttemptId(null)
    setAnswer('')
    setFeedback(null)
    setGradeError(null)
  }

  if (activeExam) {
    const rubric = activeExam.rubric
    return (
      <div className="grid gap-4">
        <button type="button" onClick={onBack} className="text-sm text-brand hover:underline justify-self-start">
          {t.exams.backToExams}
        </button>
        <div>
          <h2 className="font-display text-xl font-medium">{activeExam.title}</h2>
          {rubric?.durationMinutes && (
            <p className="text-xs text-muted">
              {t.exams.timeLimitLabel}: <Num>{rubric.durationMinutes}</Num> {t.exams.minutesSuffix}
            </p>
          )}
        </div>
        {!feedback && !grading && (
          <Card className="grid gap-3">
            <h3 className="text-sm font-medium">{t.exams.yourAnswer}</h3>
            <textarea
              className="min-h-64 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
              placeholder={t.exams.answerPlaceholder}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={submitting}
            />
            {gradeError && <p className="text-sm text-red-600">{gradeError}</p>}
            <Button type="button" variant="primary" onClick={onSubmitAnswer} disabled={submitting || !answer.trim()} className="justify-self-start">
              {submitting ? t.exams.submitting : t.exams.submitAnswer}
            </Button>
          </Card>
        )}
        {grading && (
          <Card>
            <Skeleton className="h-24" />
            <p className="mt-3 text-sm text-muted">{t.exams.grading}</p>
          </Card>
        )}
        {gradeError && !grading && !feedback && (
          <Button type="button" variant="quiet" onClick={onRetryGrading} className="justify-self-start">
            {t.exams.retryGrading}
          </Button>
        )}
        {feedback && (
          <Card className="grid gap-4">
            <div className="flex items-center gap-2">
              <StatusChip tone="gold">
                {t.exams.score}: <Num>{feedback.score}</Num>/100
              </StatusChip>
            </div>
            {feedback.strengths.length > 0 && (
              <div>
                <h4 className="text-sm font-medium">{t.exams.strengths}</h4>
                <ul className="mt-1 list-inside list-disc text-sm text-ink">
                  {feedback.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {feedback.improvements.length > 0 && (
              <div>
                <h4 className="text-sm font-medium">{t.exams.improvements}</h4>
                <ul className="mt-1 list-inside list-disc text-sm text-ink">
                  {feedback.improvements.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {feedback.criteriaFeedback && feedback.criteriaFeedback.length > 0 && (
              <div>
                <h4 className="text-sm font-medium">{t.exams.criteriaFeedback}</h4>
                <div className="mt-1 grid gap-2">
                  {feedback.criteriaFeedback.map((c, i) => (
                    <div key={i} className="rounded-md bg-soft p-2 text-sm">
                      <p className="font-medium">{c.criterion}</p>
                      <p className="text-muted">{c.feedback}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      {isAdmin && (
        <Card className="grid gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t.exams.manageExams}</h3>
            {!formOpen && (
              <Button type="button" variant="quiet" onClick={() => setFormOpen(true)}>
                {t.exams.addExam}
              </Button>
            )}
          </div>
          {formOpen && (
            <form onSubmit={onCreateExam} className="grid gap-2">
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                  placeholder={t.exams.examTitlePlaceholder}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                />
                <input
                  className="w-24 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                  placeholder={t.exams.examYearPlaceholder}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  disabled={busy}
                />
                <input
                  className="w-32 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                  placeholder={t.exams.durationPlaceholder}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  disabled={busy}
                />
              </div>
              <textarea
                className="min-h-20 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                placeholder={t.exams.rubricPlaceholder}
                value={rubricText}
                onChange={(e) => setRubricText(e.target.value)}
                disabled={busy}
              />
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                  disabled={busy}
                />
                <Button type="button" variant="quiet" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                  {pendingFile ? pendingFile.name : t.exams.uploadExamFile}
                </Button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={busy || !title.trim()}>
                  {t.exams.createExam}
                </Button>
                <Button type="button" variant="quiet" onClick={() => setFormOpen(false)} disabled={busy}>
                  {t.shared.cancel}
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      {exams === null ? (
        <div className="grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : exams.length === 0 ? (
        <EmptyState title={t.exams.noExamsYet} />
      ) : (
        <div className="grid gap-2">
          {exams.map((exam) => (
            <Card key={exam.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{exam.title}</p>
                <p className="truncate text-xs text-muted">{exam.year ? <Num>{exam.year}</Num> : null}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {exam.documents && (
                  <Button type="button" variant="quiet" onClick={() => onOpenFile(exam)}>
                    {t.exams.viewFile}
                  </Button>
                )}
                <Button type="button" variant="primary" onClick={() => onStart(exam)}>
                  {t.exams.startSimulation}
                </Button>
                {isAdmin && (
                  <Button type="button" variant="quiet" onClick={() => onDeleteExam(exam.id)}>
                    {t.exams.deleteExam}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {myAttempts.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium text-muted">{t.exams.myAttempts}</h3>
          {myAttempts.map((a) => (
            <Card key={a.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{a.exams?.title}</p>
                <p className="truncate text-xs text-muted">{a.exams?.year ? <Num>{a.exams.year}</Num> : null}</p>
              </div>
              <StatusChip tone={a.feedback ? 'gold' : 'pending'}>
                {a.feedback ? (
                  <>
                    {t.exams.score}: <Num>{a.feedback.score}</Num>/100
                  </>
                ) : (
                  t.exams.attemptPending
                )}
              </StatusChip>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
