import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase, type Course } from '../../lib/supabase'
import { useAgentPanel } from '../../components/agent/AgentPanelContext'
import { SummariesPanel } from './SummariesPanel'
import { RulingsPanel } from './RulingsPanel'
import { PracticePanel } from './PracticePanel'
import { SharedPanel } from './SharedPanel'
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
    <div className="portal-page course-page mx-auto max-w-5xl px-6 py-10 pb-24 md:px-10">
      <div className="course-heading mb-6"><p className="eyebrow">תיקיית קורס</p>
        <h1 className="font-display text-3xl font-medium">{course.title}</h1>
        <p className="text-sm text-muted">
          {course.lecturer} · {course.year_label} {course.semester ? `· סמסטר ${course.semester}` : ''}
        </p>
      </div>
      <div aria-label="אזורי הקורס" className="course-tabs mb-7 flex gap-6 overflow-auto border-b border-line">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            aria-current={active.key === tb.key ? 'page' : undefined}
            onClick={() => setParams({ tab: tb.key })}
            className={`whitespace-nowrap border-b-2 pb-3 text-sm ${
              tb.key === active.key ? 'border-brand font-semibold text-brand' : 'border-transparent text-muted'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      {active.key === 'summaries' ? (
        <SummariesPanel courseId={course.id} />
      ) : active.key === 'rulings' ? (
        <RulingsPanel courseId={course.id} />
      ) : active.key === 'practice' ? (
        <PracticePanel courseId={course.id} courseTitle={course.title} />
      ) : (
        <SharedPanel courseId={course.id} />
      )}
      <button
        type="button"
        onClick={() => openAgent(course.title)}
        className="course-agent fixed inset-x-4 bottom-20 z-30 mx-auto flex max-w-md items-center gap-2 rounded-full border border-line bg-surface px-4 py-3 text-sm text-muted shadow-lg hover:border-brand hover:text-brand md:bottom-6 md:start-6 md:end-auto md:mx-0"
      >
        <span aria-hidden="true">✦</span>
        {t.course.agentBar}
      </button>
    </div>
  )
}
