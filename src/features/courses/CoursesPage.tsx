import { useEffect, useState } from 'react'
import { supabase, type Course } from '../../lib/supabase'
import { useAuth } from '../../app/AuthContext'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/Primitives'
import { CourseCard } from './CourseCard'
import { t } from '../../i18n/he'

export function CoursesPage() {
  const { profile } = useAuth()
  const [courses, setCourses] = useState<Course[] | null>(null)

  async function load() {
    const { data } = await supabase.from('courses').select('*').eq('archived', false).order('position')
    setCourses((data as Course[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function addDemoCourse() {
    const title = prompt('שם הקורס החדש?')
    if (!title) return
    await supabase.from('courses').insert({ title, position: (courses?.length ?? 0) + 1 })
    load()
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 pb-24 md:px-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium">{t.courses.title}</h1>
          <p className="text-sm text-muted">{t.courses.subtitle}</p>
        </div>
        {profile?.role === 'admin' && <Button variant="primary" onClick={addDemoCourse}>{t.courses.newCourse}</Button>}
      </div>
      {courses === null ? null : courses.length === 0 ? (
        <EmptyState title={t.courses.empty} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
      )}
    </div>
  )
}
