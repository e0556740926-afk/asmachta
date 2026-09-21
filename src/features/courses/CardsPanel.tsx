import { useEffect, useState } from 'react'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Skeleton } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'
import {
  createCard,
  deleteCard,
  fetchCardStates,
  fetchCards,
  rateCard,
  suggestCards,
  updateCard,
  type CardSuggestion,
} from '../../lib/practice'
import type { CardRow, CardState } from '../../lib/supabase'

function isDue(state: CardState | undefined): boolean {
  if (!state || !state.due) return true
  return new Date(state.due).getTime() <= Date.now()
}

export function CardsPanel({ courseId, courseTitle }: { courseId: string; courseTitle: string }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [cards, setCards] = useState<CardRow[] | null>(null)
  const [states, setStates] = useState<Record<string, CardState>>({})
  const [error, setError] = useState<string | null>(null)

  const [newFront, setNewFront] = useState('')
  const [newBack, setNewBack] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')

  const [suggestions, setSuggestions] = useState<CardSuggestion[] | null>(null)
  const [suggestBusy, setSuggestBusy] = useState(false)

  const [queue, setQueue] = useState<CardRow[] | null>(null)
  const [queueIndex, setQueueIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [rateBusy, setRateBusy] = useState(false)

  async function load() {
    const rows = await fetchCards(courseId)
    setCards(rows)
    if (profile) setStates(await fetchCardStates(profile.id, rows.map((c) => c.id)))
  }

  useEffect(() => {
    load().catch(() => setError(t.course.uploadError))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, profile?.id])

  async function onAddCard(e: React.FormEvent) {
    e.preventDefault()
    if (!newFront.trim() || !newBack.trim()) return
    setAddBusy(true)
    setError(null)
    try {
      await createCard(courseId, newFront.trim(), newBack.trim())
      setNewFront('')
      setNewBack('')
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setAddBusy(false)
    }
  }

  async function onSaveEdit(id: string) {
    await updateCard(id, editFront.trim(), editBack.trim())
    setEditingId(null)
    await load()
  }

  async function onDeleteCard(id: string) {
    await deleteCard(id)
    await load()
  }

  async function onSuggest() {
    setSuggestBusy(true)
    setError(null)
    try {
      const items = await suggestCards(courseId, courseTitle, 8)
      setSuggestions(items)
    } catch {
      setError(t.practice.aiSuggestError)
    } finally {
      setSuggestBusy(false)
    }
  }

  async function onAcceptSuggestion(s: CardSuggestion) {
    await createCard(courseId, s.front, s.back)
    setSuggestions((prev) => (prev ?? []).filter((x) => x !== s))
    await load()
  }

  async function onAcceptAllSuggestions() {
    const items = suggestions ?? []
    for (const s of items) await createCard(courseId, s.front, s.back)
    setSuggestions(null)
    await load()
  }

  function startStudy() {
    const due = (cards ?? []).filter((c) => isDue(states[c.id]))
    setQueue(due)
    setQueueIndex(0)
    setRevealed(false)
  }

  async function onRate(rating: 'again' | 'good') {
    if (!profile || !queue) return
    const card = queue[queueIndex]
    setRateBusy(true)
    try {
      await rateCard(profile.id, card.id, states[card.id], rating)
    } catch {
      // best-effort; still advance so the session isn't blocked by a transient error
    } finally {
      setRateBusy(false)
      setRevealed(false)
      setQueueIndex((i) => i + 1)
    }
  }

  const studying = queue !== null && queueIndex < queue.length
  const studyDone = queue !== null && queueIndex >= queue.length

  return (
    <div className="grid gap-6">
      {isAdmin && (
        <Card className="grid gap-4">
          <h2 className="font-display text-lg font-medium">{t.practice.manageCards}</h2>
          <form onSubmit={onAddCard} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
              placeholder={t.practice.cardFront}
              value={newFront}
              onChange={(e) => setNewFront(e.target.value)}
              disabled={addBusy}
            />
            <input
              className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
              placeholder={t.practice.cardBack}
              value={newBack}
              onChange={(e) => setNewBack(e.target.value)}
              disabled={addBusy}
            />
            <Button type="submit" variant="primary" disabled={addBusy}>
              {t.practice.addCard}
            </Button>
          </form>

          <div className="flex items-center gap-3">
            <Button type="button" variant="quiet" onClick={onSuggest} disabled={suggestBusy}>
              {suggestBusy ? t.practice.aiSuggesting : t.practice.aiSuggestCards}
            </Button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          {suggestions !== null && (
            <div className="grid gap-2 rounded-md border border-dashed border-line p-3">
              {suggestions.length === 0 ? (
                <p className="text-sm text-muted">{t.practice.aiSuggestEmpty}</p>
              ) : (
                <>
                  {suggestions.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 rounded-md bg-soft p-2">
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-medium">{s.front}</p>
                        <p className="truncate text-muted">{s.back}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button type="button" variant="quiet" onClick={() => onAcceptSuggestion(s)}>
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
                  <Button type="button" variant="primary" onClick={onAcceptAllSuggestions} className="justify-self-start">
                    {t.practice.acceptAllSuggestions}
                  </Button>
                </>
              )}
            </div>
          )}

          {cards && cards.length > 0 && (
            <div className="grid gap-2">
              {cards.map((c) =>
                editingId === c.id ? (
                  <div key={c.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
                    <input
                      className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                      value={editFront}
                      onChange={(e) => setEditFront(e.target.value)}
                    />
                    <input
                      className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                      value={editBack}
                      onChange={(e) => setEditBack(e.target.value)}
                    />
                    <Button type="button" variant="primary" onClick={() => onSaveEdit(c.id)}>
                      {t.practice.saveCard}
                    </Button>
                    <Button type="button" variant="quiet" onClick={() => setEditingId(null)}>
                      {t.practice.cancelEdit}
                    </Button>
                  </div>
                ) : (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-md bg-soft p-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.front}</p>
                      <p className="truncate text-muted">{c.back}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() => {
                          setEditingId(c.id)
                          setEditFront(c.front)
                          setEditBack(c.back)
                        }}
                      >
                        {t.practice.editCard}
                      </Button>
                      <Button type="button" variant="quiet" onClick={() => onDeleteCard(c.id)}>
                        {t.course.deleteFile}
                      </Button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </Card>
      )}

      <Card className="grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-medium">{t.practice.studyCards}</h2>
          {cards && cards.length > 0 && !studying && (
            <Button type="button" variant="primary" onClick={startStudy}>
              {t.practice.studyStart}
            </Button>
          )}
        </div>

        {cards === null ? (
          <Skeleton className="h-24" />
        ) : cards.length === 0 ? (
          <EmptyState title={t.practice.noCardsYet} />
        ) : studyDone ? (
          <EmptyState title={t.practice.studyDone} action={<Button type="button" onClick={startStudy}>{t.practice.studyStart}</Button>} />
        ) : studying && queue ? (
          <div className="grid gap-4">
            <p className="text-xs text-muted">
              {queueIndex + 1} / {queue.length}
            </p>
            <div className="rounded-lg border border-line bg-tint p-8 text-center">
              <p className="text-lg font-medium">{queue[queueIndex].front}</p>
              {revealed && <p className="mt-4 border-t border-line pt-4 text-muted">{queue[queueIndex].back}</p>}
            </div>
            {!revealed ? (
              <Button type="button" variant="primary" onClick={() => setRevealed(true)} className="justify-self-center">
                {t.practice.showAnswer}
              </Button>
            ) : (
              <div className="flex justify-center gap-3">
                <Button type="button" onClick={() => onRate('again')} disabled={rateBusy}>
                  {t.practice.ratingAgain}
                </Button>
                <Button type="button" variant="primary" onClick={() => onRate('good')} disabled={rateBusy}>
                  {t.practice.ratingGood}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
