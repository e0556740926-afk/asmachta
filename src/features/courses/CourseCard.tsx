import { Link } from 'react-router-dom'
import type { Course } from '../../lib/supabase'

export function CourseCard({ course }: { course: Course }) {
  return (
    <Link
      to={`/courses/${course.id}`}
      className="group relative mt-3 block rounded-e-[var(--radius-token)] rounded-s-none border border-line bg-surface p-6 transition-transform hover:-translate-y-0.5 hover:border-brand"
      style={{ ['--course' as string]: course.color === 'gold' ? 'var(--gold)' : 'var(--brand)' }}
    >
      <span className="mb-5 block h-1 w-7 rounded" style={{ background: 'var(--course)' }} />
      <h3 className="font-display text-xl font-medium">{course.title}</h3>
      <p className="mb-4 mt-1 text-sm text-muted">
        {course.lecturer} · {course.year_label}
      </p>
      <div className="flex justify-between text-xs text-muted">
        <span>{course.semester ? `סמסטר ${course.semester}` : ''}</span>
        <span className="opacity-0 transition-opacity group-hover:opacity-100">פתיחה ←</span>
      </div>
    </Link>
  )
}
