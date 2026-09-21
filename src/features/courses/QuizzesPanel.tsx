import { useEffect, useState } from 'react'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Skeleton, StatusChip } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'
import {
  addQuestion,
  createQuiz,
  deleteQuestion,
  deleteQuiz,
  fetchQuizzes,
  scoreAttempt,
  submitQuizAttempt,
  suggestQuestions,
  type QuestionSuggestion,
} from '../../lib/practice'
import type { QuizQuestionRow, QuizWithQuestions } from '../../lib/supabase'

const OPTION_LABELS = ['א', 'ב', 'ג', 'ד']

function QuestionEditor({
  quizId,
  onAdded,
}: {
  quizId: string
  onAdded: () => void
}) {
  const [stem, setStem] = useState('')
  const [options, setOptions] = useState(['', '', '', ''])
  const [correct, setCorrect] = useState(0)
  const [explanation, setExplanation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const filled = options.map((o) => o.trim()).filter(Boolean)
    if (!stem.trim() || filled.length < 2 || !options[correct]?.trim()) {
      setError(t.practice.correctAnswerHint)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addQuestion(quizId, { stem: stem.trim(), options: filled, answer: options[correct].trim(), explanation: explanation.trim() || undefined })
      setStem('')
      setOptions(['', '', '', ''])
      setCorrect(0)
      setExplanation('')
      onAdded()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2 rounded-md border border-line p-3">
      <input
        className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
        placeholder={t.practice.questionStem}
        value={stem}
        onChange={(e) => setStem(e.target.value)}
        disabled={busy}
      />
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="radio"
            name={`correct-${quizId}`}
            checked={correct === i}
            onChange={() => setCorrect(i)}
            disabled={busy}
          />
          <input
            className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
            placeholder={`${t.practice.optionLabel} ${OPTION_LABELS[i]}`}
            value={opt}
            onChange={(e) => setOptions((prev) => prev.map((o, idx) => (idx === i ? e.target.value : o)))}
            disabled={busy}
          />
        </div>
      ))}
      <p className="text-xs text-muted">{t.practice.correctAnswerHint}</p>
      <input
        className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
        placeholder={t.practice.explanationOptional}
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
        disabled={busy}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy} className="justify-self-start">
        {t.practice.addQuestion}
      </Button>
    </form>
  )
}

function QuizTaker({ quiz, onBack }: { quiz: QuizWithQuestions; onBack: () => void }) {
  const { profile } = useAuth()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    if (!profile) return
    setBusy(true)
    try {
      const s = scoreAttempt(quiz.quiz_questions, answers)
      await submitQuizAttempt(profile.id, quiz.id, answers, s)
      setScore(s)
      setSubmitted(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-medium">{quiz.title}</h2>
        <Button type="button" variant="quiet" onClick={onBack}>
          {t.practice.backToQuizzes}
        </Button>
      </div>
      {submitted && score !== null && (
        <p className="text-lg font-medium text-brand">
          {t.practice.quizScore}: <span dir="ltr">{score}%</span>
        </p>
      )}
      <div className="grid gap-4">
        {quiz.quiz_questions.map((q) => {
          const picked = answers[q.id]
          const isCorrect = submitted && picked === q.answer
          return (
            <div key={q.id} className="grid gap-2 rounded-md border border-line p-3">
              <p className="font-medium">{q.stem}</p>
              <div className="grid gap-1">
                {(q.options ?? []).map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={q.id}
                      checked={picked === opt}
                      disabled={submitted}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                    />
                    <span className={submitted && opt === q.answer ? 'font-medium text-brand' : ''}>{opt}</span>
                  </label>
                ))}
              </div>
              {submitted && (
                <div className="text-xs">
                  <StatusChip tone={isCorrect ? 'brand' : 'pending'}>
                    {isCorrect ? t.practice.correctBadge : t.practice.incorrectBadge}
                  </StatusChip>
                  {q.explanation && <p className="mt-1 text-muted">{q.explanation}</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!submitted && (
        <Button type="button" variant="primary" onClick={onSubmit} disabled={busy} className="justify-self-start">
          {t.practice.submitQuiz}
        </Button>
      )}
    </Card>
  )
}

export function QuizzesPanel({ courseId, courseTitle }: { courseId: string; courseTitle: string }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [quizzes, setQuizzes] = useState<QuizWithQuestions[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [takingId, setTakingId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<QuestionSuggestion[] | null>(null)
  const [suggestBusy, setSuggestBusy] = useState(false)

  async function load() {
    setQuizzes(await fetchQuizzes(courseId))
  }

  useEffect(() => {
    load().catch(() => setError(t.course.uploadError))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  async function onCreateQuiz(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return
    setCreating(true)
    setError(null)
    try {
      const id = await createQuiz(courseId, newTitle.trim())
      setNewTitle('')
      await load()
      setExpandedId(id)
    } catch {
      setError(t.course.uploadError)
    } finally {
      setCreating(false)
    }
  }

  async function onDeleteQuiz(id: string) {
    await deleteQuiz(id)
    if (expandedId === id) setExpandedId(null)
    await load()
  }

  async function onDeleteQuestion(id: string) {
    await deleteQuestion(id)
    await load()
  }

  async function onSuggest(quizId: string) {
    setSuggestBusy(true)
    setError(null)
    try {
      setSuggestions(await suggestQuestions(courseId, courseTitle, 8))
    } catch {
      setError(t.practice.aiSuggestError)
    } finally {
      setSuggestBusy(false)
    }
    void quizId
  }

  async function onAcceptSuggestion(quizId: string, s: QuestionSuggestion) {
    await addQuestion(quizId, s)
    setSuggestions((prev) => (prev ?? []).filter((x) => x !== s))
    await load()
  }

  async function onAcceptAllSuggestions(quizId: string) {
    for (const s of suggestions ?? []) await addQuestion(quizId, s)
    setSuggestions(null)
    await load()
  }

  const taking = takingId ? (quizzes ?? []).find((q) => q.id === takingId) : null
  if (taking) return <QuizTaker quiz={taking} onBack={() => setTakingId(null)} />

  return (
    <div className="grid gap-6">
      {isAdmin && (
        <Card className="grid gap-3">
          <h2 className="font-display text-lg font-medium">{t.practice.newQuiz}</h2>
          <form onSubmit={onCreateQuiz} className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
              placeholder={t.practice.quizTitlePlaceholder}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              disabled={creating}
            />
            <Button type="submit" variant="primary" disabled={creating}>
              {t.practice.createQuiz}
            </Button>
          </form>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </Card>
      )}

      {quizzes === null ? (
        <Skeleton className="h-24" />
      ) : quizzes.length === 0 ? (
        <EmptyState title={t.practice.noQuizzesYet} />
      ) : (
        <div className="grid gap-3">
          {quizzes.map((quiz) => (
            <Card key={quiz.id} className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{quiz.title}</p>
                  <p className="text-xs text-muted">
                    {quiz.quiz_questions.length} {t.practice.questionCount}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {quiz.quiz_questions.length > 0 && (
                    <Button type="button" variant="primary" onClick={() => setTakingId(quiz.id)}>
                      {t.practice.takeQuiz}
                    </Button>
                  )}
                  {isAdmin && (
                    <>
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() => {
                          setExpandedId((cur) => (cur === quiz.id ? null : quiz.id))
                          setSuggestions(null)
                        }}
                      >
                        {expandedId === quiz.id ? t.practice.hideQuestions : t.practice.manageQuestions}
                      </Button>
                      <Button type="button" variant="quiet" onClick={() => onDeleteQuiz(quiz.id)}>
                        {t.practice.deleteQuiz}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {isAdmin && expandedId === quiz.id && (
                <div className="grid gap-3 border-t border-line pt-3">
                  {quiz.quiz_questions.map((q: QuizQuestionRow) => (
                    <div key={q.id} className="flex items-center justify-between gap-3 rounded-md bg-soft p-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{q.stem}</p>
                        <p className="truncate text-muted">{(q.options ?? []).join(' · ')}</p>
                      </div>
                      <Button type="button" variant="quiet" onClick={() => onDeleteQuestion(q.id)}>
                        {t.course.deleteFile}
                      </Button>
                    </div>
                  ))}

                  <QuestionEditor quizId={quiz.id} onAdded={load} />

                  <Button type="button" variant="quiet" onClick={() => onSuggest(quiz.id)} disabled={suggestBusy} className="justify-self-start">
                    {suggestBusy ? t.practice.aiSuggesting : t.practice.aiSuggestQuestions}
                  </Button>

                  {suggestions !== null && (
                    <div className="grid gap-2 rounded-md border border-dashed border-line p-3">
                      {suggestions.length === 0 ? (
                        <p className="text-sm text-muted">{t.practice.aiSuggestEmpty}</p>
                      ) : (
                        <>
                          {suggestions.map((s, i) => (
                            <div key={i} className="flex items-center justify-between gap-3 rounded-md bg-soft p-2 text-sm">
                              <div className="min-w-0">
                                <p className="truncate font-medium">{s.stem}</p>
                                <p className="truncate text-muted">{s.options.join(' · ')}</p>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <Button type="button" variant="quiet" onClick={() => onAcceptSuggestion(quiz.id, s)}>
                                  {t.practice.acceptSuggestion}
                                </Button>
                                <Button
                                  type="button"
                                  variant="quiet"
                                  onClick={() => setSuggestions((prev) => (prev ?? []).filter((x) => x !== s))}
                                >
                                  {t.practice.discardSuggestion}
                                </Button>
                              </div>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() => onAcceptAllSuggestions(quiz.id)}
                            className="justify-self-start"
                          >
                            {t.practice.acceptAllSuggestions}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
