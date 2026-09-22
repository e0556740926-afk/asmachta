import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/AuthContext'
import { supabase, type Course } from '../../lib/supabase'
import {
  fetchContinueReading,
  fetchHomeStats,
  fetchLearningPulse,
  fetchQuickReviewCard,
  fetchRecentActivity,
  type ActivityItem,
  type ContinueItem,
  type HomeStats,
  type LearningPulse,
  type QuickReviewCard,
} from '../../lib/home'
import { Card, EmptyState, Num, Skeleton } from '../../components/ui/Primitives'
import { CourseCard } from '../courses/CourseCard'
import { t } from '../../i18n/he'

export function HomePage() {
  const { profile } = useAuth()
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [continueItem, setContinueItem] = useState<ContinueItem | null | undefined>(undefined)
  const [stats, setStats] = useState<HomeStats | null>(null)
  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [quickReview, setQuickReview] = useState<QuickReviewCard | null | undefined>(undefined)
  const [pulse, setPulse] = useState<LearningPulse | undefined>(undefined)

  useEffect(() => {
    supabase
      .from('courses')
      .select('*')
      .eq('archived', false)
      .order('position')
      .then(({ data }) => setCourses((data as Course[]) ?? []))
  }, [])

  useEffect(() => {
    if (!profile) return
    fetchContinueReading(profile.id).then(setContinueItem)
    fetchHomeStats(profile.id).then(setStats)
    fetchQuickReviewCard(profile.id).then(setQuickReview)
    fetchLearningPulse(profile.id).then(setPulse)
  }, [profile])

  useEffect(() => {
    fetchRecentActivity().then(setActivity)
  }, [])

  return (
    <div className="home-page portal-page mx-auto max-w-5xl px-6 py-10 pb-24 md:px-10">
      <div className="page-intro mb-8"><span className="eyebrow">מרחב אישי / הלימודים שלי</span>
        <p className="font-medium text-brand">{t.home.title}</p>
        <h1 className="font-display text-4xl font-medium">
          {profile?.display_name ? `שלום, ${profile.display_name}` : t.home.subtitle}
        </h1>
      </div>

      <Card className="continue-card mb-6 border-brand bg-brand text-surface">
        <p className="mb-2 text-sm opacity-80">{t.home.continueTitle}</p>
        {continueItem === undefined ? (
          <Skeleton className="h-16 bg-surface/20" />
        ) : continueItem ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs opacity-80">{continueItem.courseTitle}</p>
              <h2 className="font-display text-2xl font-medium">{continueItem.topicTitle}</h2>
            </div>
            <Link
              to={`/courses/${continueItem.courseId}?tab=summaries`}
              className="shrink-0 rounded-md bg-surface px-4 py-2 text-sm font-medium text-brand hover:opacity-90"
            >
              {t.home.continueCta} ←
            </Link>
          </div>
        ) : (
          <p className="text-sm opacity-90">{t.home.continueEmpty}</p>
        )}
      </Card>

      <div className="mb-8 grid grid-cols-2 gap-4">
        <Card>
          <p className="mb-1 text-xs text-muted">{t.home.statsTopics}</p>
          {stats ? (
            <p className="font-display text-2xl font-medium">
              <Num>
                {stats.topicsViewed}/{stats.topicsTotal}
              </Num>
            </p>
          ) : (
            <Skeleton className="h-7 w-16" />
          )}
        </Card>
        <Card>
          <p className="mb-1 text-xs text-muted">{t.home.statsCards}</p>
          {stats ? (
            <p className="font-display text-2xl font-medium text-brand">
              <Num>{stats.cardsDue}</Num>
            </p>
          ) : (
            <Skeleton className="h-7 w-16" />
          )}
        </Card>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium">{t.home.coursesSection}</h2>
        <Link to="/courses" className="text-sm text-brand">
          {t.home.seeAll}
        </Link>
      </div>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses === null ? (
          <>
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </>
        ) : courses.length === 0 ? (
          <EmptyState title={t.home.coursesEmpty} />
        ) : (
          courses.slice(0, 3).map((c) => <CourseCard key={c.id} course={c} />)
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <Card>
          <h2 className="mb-4 font-display text-lg font-medium">{t.home.activityTitle}</h2>
          {activity === null ? (
            <div className="grid gap-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : activity.length === 0 ? (
            <EmptyState title={t.home.activityEmpty} />
          ) : (
            <div className="grid gap-3">
              {activity.map((item) => (
                <Link
                  key={item.id}
                  to={`/courses/${item.courseId}?tab=shared`}
                  className="grid gap-0.5 rounded-md bg-soft p-3 text-sm hover:bg-tint"
                >
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="text-xs text-muted">
                    {item.uploaderName ?? ''} · {t.home.activitySharedTo} {item.courseTitle}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <aside className="desk-aside grid content-start gap-4">
          <div className="daily-practice">
            <div className="flex items-center justify-between">
              <span className="eyebrow">{t.home.quickReviewTitle}</span>
              <span aria-hidden="true">🗂</span>
            </div>
            {stats === null ? (
              <Skeleton className="mt-3 h-16 bg-surface/40" />
            ) : (
              <>
                <p className="big-number">
                  <Num>{stats.cardsDue}</Num>
                  <small>{t.home.statsCards}</small>
                </p>
                {quickReview === undefined ? (
                  <Skeleton className="mt-3 h-8 bg-surface/40" />
                ) : quickReview ? (
                  <>
                    <p className="truncate">{quickReview.front}</p>
                    <Link to={`/courses/${quickReview.courseId}?tab=practice`}>{t.home.quickReviewCta} ←</Link>
                  </>
                ) : (
                  <p>{t.home.quickReviewEmpty}</p>
                )}
              </>
            )}
            {pulse && (
              <div className="tiny-streak">
                {pulse.dayLabels.map((label, i) => (
                  <span key={i} className={[pulse.activeDays[i] ? 'active' : '', i === 6 ? 'today' : ''].join(' ').trim()}>
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="learning-pulse">
            <div className="flex items-center justify-between">
              <strong>{t.home.pulseTitle}</strong>
              <span className="text-xs text-muted">{t.home.pulseSubtitle}</span>
            </div>
            {pulse === undefined ? (
              <Skeleton className="mt-4 h-24" />
            ) : (
              <>
                <div className="pulse-stats">
                  <div>
                    <bdi>
                      <Num>{pulse.topicsThisWeek}</Num>
                    </bdi>
                    <span>{t.home.pulseTopics}</span>
                  </div>
                  <div>
                    <bdi>{pulse.accuracyPct !== null ? <Num>{pulse.accuracyPct}%</Num> : '—'}</bdi>
                    <span>{t.home.pulseAccuracy}</span>
                  </div>
                </div>
                <div className="week-chart" aria-label={t.home.pulseChartLabel}>
                  {pulse.dailyCounts.map((c, i) => {
                    const max = Math.max(...pulse.dailyCounts, 1)
                    const pct = c > 0 ? Math.max(8, Math.round((c / max) * 100)) : 3
                    return <i key={i} className={i === 6 ? 'today' : ''} style={{ height: `${pct}%` }} />
                  })}
                </div>
                {pulse.dailyCounts.every((c) => c === 0) && <p className="text-xs text-muted">{t.home.pulseEmpty}</p>}
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
