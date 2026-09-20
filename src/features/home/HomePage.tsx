import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, type Course } from '../../lib/supabase'
import { Card } from '../../components/ui/Primitives'
import { CourseCard } from '../courses/CourseCard'
import { t } from '../../i18n/he'

export function HomePage() {
  const [courses, setCourses] = useState<Course[] | null>(null)

  useEffect(() => {
    supabase
      .from('courses')
      .select('*')
      .eq('archived', false)
      .order('position')
      .then(({ data }) => setCourses((data as Course[]) ?? []))
  }, [])

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 pb-24 md:px-10">
      <div className="mb-8">
        <p className="font-medium text-brand">{t.home.title}</p>
        <h1 className="font-display text-4xl font-medium">{t.home.subtitle}</h1>
      </div>
      <Card className="mb-8 border-brand bg-brand text-surface">
        <p className="mb-2 text-sm opacity-80">אסמכתא</p>
        <h2 className="mb-2 font-display text-2xl font-medium">ברוך הבא</h2>
        <p className="text-sm opacity-90">כל הקורסים, הסיכומים ופסקי הדין שלך במקום אחד.</p>
      </Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium">{t.home.coursesSection}</h2>
        <Link to="/courses" className="text-sm text-brand">
          {t.home.seeAll}
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses?.slice(0, 3).map((c) => (
          <CourseCard key={c.id} course={c} />
        ))}
      </div>
    </div>
  )
}
