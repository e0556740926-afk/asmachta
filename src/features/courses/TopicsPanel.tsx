import { useEffect, useState } from 'react'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, Skeleton } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'
import {
  addManualSection,
  createTopic,
  deleteSection,
  deleteTopic,
  ensureManualSummary,
  fetchTopics,
  recordTopicProgress,
  updateSection,
  updateTopicTitle,
} from '../../lib/topics'
import type { TopicSectionRow, TopicWithSections } from '../../lib/supabase'

/** Per-course AI-organized topic map: a list of topics (each with a section count) that opens
 * into a reader-style detail view per topic. Admins can also create topics/sections manually. */
export function TopicsPanel({ courseId, refreshKey }: { courseId: string; refreshKey?: number }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [topics, setTopics] = useState<TopicWithSections[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openTopicId, setOpenTopicId] = useState<string | null>(null)

  const [newTopicTitle, setNewTopicTitle] = useState('')
  const [addTopicBusy, setAddTopicBusy] = useState(false)

  async function load() {
    try {
      const rows = await fetchTopics(courseId)
      setTopics(rows)
    } catch {
      setError(t.course.uploadError)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, refreshKey])

  async function onAddTopic(e: React.FormEvent) {
    e.preventDefault()
    if (!newTopicTitle.trim()) return
    setAddTopicBusy(true)
    setError(null)
    try {
      const position = topics ? topics.length : 0
      await createTopic(courseId, newTopicTitle.trim(), position)
      setNewTopicTitle('')
      await load()
    } catch {
      setError(t.course.uploadError)
    } finally {
      setAddTopicBusy(false)
    }
  }

  function handleOpenTopic(topicId: string) {
    setOpenTopicId(topicId)
    if (profile) recordTopicProgress(profile.id, topicId).catch(() => {})
  }

  async function onDeleteTopic(topicId: string) {
    if (!window.confirm(t.topics.confirmDeleteTopic)) return
    await deleteTopic(topicId)
    if (openTopicId === topicId) setOpenTopicId(null)
    await load()
  }

  if (topics === null) {
    return (
      <Card className="grid gap-2">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </Card>
    )
  }

  const openTopic = topics.find((tp) => tp.id === openTopicId) ?? null

  if (openTopic) {
    return (
      <TopicDetail
        topic={openTopic}
        courseId={courseId}
        isAdmin={isAdmin}
        onBack={() => setOpenTopicId(null)}
        onChanged={load}
        onDeleteTopic={() => onDeleteTopic(openTopic.id)}
      />
    )
  }

  return (
    <Card className="grid gap-4">
      <h2 className="font-display text-lg font-medium">{t.topics.heading}</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {topics.length === 0 ? (
        <EmptyState title={t.topics.empty} />
      ) : (
        <div className="grid gap-2">
          {topics.map((tp) => (
            <button
              key={tp.id}
              type="button"
              onClick={() => handleOpenTopic(tp.id)}
              className="topic-row flex items-center justify-between gap-3 rounded-md bg-soft p-3 text-start text-sm hover:bg-tint"
            >
              <span className="truncate font-medium">{tp.title}</span>
              <span className="shrink-0 text-xs text-muted">
                {tp.topic_sections.length} {t.topics.sectionsCount}
              </span>
            </button>
          ))}
        </div>
      )}
      {isAdmin && (
        <form onSubmit={onAddTopic} className="flex items-center gap-2 border-t border-line pt-4">
          <input
            className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
            placeholder={t.topics.newTopicTitle}
            value={newTopicTitle}
            onChange={(e) => setNewTopicTitle(e.target.value)}
            disabled={addTopicBusy}
          />
          <Button type="submit" variant="primary" disabled={addTopicBusy}>
            {t.topics.addTopic}
          </Button>
        </form>
      )}
    </Card>
  )
}

function TopicDetail({
  topic,
  courseId,
  isAdmin,
  onBack,
  onChanged,
  onDeleteTopic,
}: {
  topic: TopicWithSections
  courseId: string
  isAdmin: boolean
  onBack: () => void
  onChanged: () => Promise<void>
  onDeleteTopic: () => void
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(topic.title)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [sectionHeadingDraft, setSectionHeadingDraft] = useState('')
  const [sectionContentDraft, setSectionContentDraft] = useState('')
  const [addingSection, setAddingSection] = useState(false)
  const [newSectionHeading, setNewSectionHeading] = useState('')
  const [newSectionContent, setNewSectionContent] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSaveTitle() {
    if (!titleDraft.trim()) return
    setBusy(true)
    try {
      await updateTopicTitle(topic.id, titleDraft.trim())
      setEditingTitle(false)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  function startEditSection(s: TopicSectionRow) {
    setEditingSectionId(s.id)
    setSectionHeadingDraft(s.heading ?? '')
    setSectionContentDraft(s.html ?? '')
  }

  async function onSaveSection(sectionId: string) {
    if (!sectionContentDraft.trim()) return
    setBusy(true)
    try {
      await updateSection(sectionId, sectionHeadingDraft.trim(), sectionContentDraft)
      setEditingSectionId(null)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteSection(sectionId: string) {
    if (!window.confirm(t.topics.deleteSection)) return
    await deleteSection(sectionId)
    await onChanged()
  }

  async function onAddSection(e: React.FormEvent) {
    e.preventDefault()
    if (!newSectionContent.trim()) return
    setBusy(true)
    try {
      const summaryId = await ensureManualSummary(courseId)
      const position = topic.topic_sections.length
      await addManualSection(topic.id, summaryId, position, newSectionHeading.trim(), newSectionContent)
      setNewSectionHeading('')
      setNewSectionContent('')
      setAddingSection(false)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="topic-reader grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="text-sm text-brand hover:underline">
          {t.topics.backToTopics}
        </button>
        {isAdmin && (
          <Button type="button" variant="quiet" onClick={onDeleteTopic}>
            {t.topics.deleteTopic}
          </Button>
        )}
      </div>

      {editingTitle ? (
        <div className="flex items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-lg font-medium text-ink"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            disabled={busy}
          />
          <Button type="button" variant="primary" onClick={onSaveTitle} disabled={busy}>
            {t.topics.saveTopicTitle}
          </Button>
          <Button type="button" variant="quiet" onClick={() => setEditingTitle(false)} disabled={busy}>
            {t.topics.cancelEdit}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-medium">{topic.title}</h2>
          {isAdmin && (
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setTitleDraft(topic.title)
                setEditingTitle(true)
              }}
            >
              {t.topics.editTopicTitle}
            </Button>
          )}
        </div>
      )}

      <nav className="reader-toc" aria-label="תוכן עניינים">{topic.topic_sections.map((section, index) => <a key={section.id} href={`#section-${section.id}`}><bdi>{String(index + 1).padStart(2, "0")}</bdi>{section.heading || `סעיף ${index + 1}`}</a>)}</nav>
      {topic.topic_sections.length === 0 ? (
        <EmptyState title={t.topics.empty} />
      ) : (
        <div className="grid gap-4">
          {topic.topic_sections.map((s) =>
            editingSectionId === s.id ? (
              <div key={s.id} className="grid gap-2 rounded-md border border-line p-3">
                <input
                  className="rounded-md border border-line bg-bg px-3 py-2 text-sm font-medium text-ink"
                  placeholder={t.topics.sectionHeading}
                  value={sectionHeadingDraft}
                  onChange={(e) => setSectionHeadingDraft(e.target.value)}
                  disabled={busy}
                />
                <textarea
                  className="min-h-32 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                  placeholder={t.topics.sectionContent}
                  value={sectionContentDraft}
                  onChange={(e) => setSectionContentDraft(e.target.value)}
                  disabled={busy}
                />
                <div className="flex gap-2">
                  <Button type="button" variant="primary" onClick={() => onSaveSection(s.id)} disabled={busy}>
                    {t.topics.saveSection}
                  </Button>
                  <Button type="button" variant="quiet" onClick={() => setEditingSectionId(null)} disabled={busy}>
                    {t.topics.cancelEdit}
                  </Button>
                </div>
              </div>
            ) : (
              <div key={s.id} id={`section-${s.id}`} className="reading-section grid gap-1 rounded-md bg-soft p-4">
                <div className="flex items-start justify-between gap-3">
                  {s.heading && <h3 className="font-medium">{s.heading}</h3>}
                  {isAdmin && (
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" variant="quiet" onClick={() => startEditSection(s)}>
                        {t.topics.editSection}
                      </Button>
                      <Button type="button" variant="quiet" onClick={() => onDeleteSection(s.id)}>
                        {t.topics.deleteSection}
                      </Button>
                    </div>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm text-ink">{s.html}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                  {s.ai_reason ? (
                    <span>
                      {t.topics.aiReasonPrefix} {s.ai_reason}
                    </span>
                  ) : (
                    <span>{t.topics.manualBadge}</span>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {isAdmin && (
        <div className="border-t border-line pt-4">
          {addingSection ? (
            <form onSubmit={onAddSection} className="grid gap-2">
              <input
                className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                placeholder={t.topics.sectionHeading}
                value={newSectionHeading}
                onChange={(e) => setNewSectionHeading(e.target.value)}
                disabled={busy}
              />
              <textarea
                className="min-h-32 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
                placeholder={t.topics.sectionContent}
                value={newSectionContent}
                onChange={(e) => setNewSectionContent(e.target.value)}
                disabled={busy}
              />
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={busy}>
                  {t.topics.saveSection}
                </Button>
                <Button type="button" variant="quiet" onClick={() => setAddingSection(false)} disabled={busy}>
                  {t.topics.cancelEdit}
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="quiet" onClick={() => setAddingSection(true)}>
              {t.topics.addSection}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
