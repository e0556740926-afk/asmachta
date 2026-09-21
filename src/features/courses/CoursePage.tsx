import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase, type Course } from '../../lib/supabase'
import { EmptyState } from '../../components/ui/Primitives'
import { useAgentPanel } from '../../components/agent/AgentPanelContext'
import { t } from '../../i18n/he'

const TABS = [
  { key: 'summaries', label: t.course.tabs.summaries, empty: t.course.emptySummaries },
  { key: 'rulings', label: t.course.tabs.rulings, empty: t.course.emptyRulings },
  { key: 'practice', label: t.course.tabs.practice, empty: t.course.emptyPractice },
  { key: 'shared', label: t.course.tabs.shared, empty: t.course.emptyShared },
] as const

export function CoursePage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const [course, setCourse] = useState<Course | null>(null)
  const tab = (params.get('tab') as (typeof TABS)[number]['key']) || 'summaries'
  const { openAgent } = useAgentPanel()

  useEffect(() => {
    if (!id) return
    supabase.from('courses').select('*').eq('id', id).maybeSingle().then(({ data }) => setCourse(data as Course))
  }, [id])

  if (!course) return null
  const active = TABS.find((tb) => tb.key === tab) ?? TABS[0]

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 pb-24 md:px-10">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-medium">{course.title}</h1>
        <p className="text-sm text-muted">
          {course.lecturer} · {course.year_label} {course.semester ? `· סמסטר ${course.semester}` : ''}
        </p>
      </div>
      <div className="mb-7 flex gap-6 overflow-auto border-b border-line">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setParams({ tab: tb.key })}
            className={`whitespace-nowrap border-b-2 pb-3 text-sm ${
              tb.key === tab ? 'border-brand font-semibold text-brand' : 'border-transparent text-muted'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      <EmptyState title={active.empty} />
      <button
        type="button"
        onClick={() => openAgent(course.title)}
        className="fixed inset-x-4 bottom-20 z-30 mx-auto flex max-w-md items-center gap-2 rounded-full border border-line bg-surface px-4 py-3 text-sm text-muted shadow-lg hover:border-brand hover:text-brand md:bottom-6 md:start-6 md:end-auto md:mx-0"
      >
        <span aria-hidden="true">✦</span>
        {t.course.agentBar}
      </button>
    </div>
  )
}
