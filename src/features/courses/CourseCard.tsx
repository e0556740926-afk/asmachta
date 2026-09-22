import { Link } from 'react-router-dom'
import type { Course } from '../../lib/supabase'

export function CourseCard({ course }: { course: Course }) {
  return (
    <Link
      to={`/courses/${course.id}`}
      className="course-folder group relative mt-3 block border border-line bg-surface p-6 transition-transform hover:-translate-y-0.5 hover:border-brand"
      style={{ ['--course' as string]: course.color === 'gold' ? '#927056' : 'var(--brand)' }}
    >
      <div className="mb-6 flex items-center justify-between">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--course)" strokeWidth="1.4" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" /></svg>
        <span className="text-xs text-muted">תיקיית קורס</span>
      </div>
      <h3 className="font-display text-xl font-medium">{course.title}</h3>
      <p className="mb-4 mt-1 text-sm text-muted">
        {[course.lecturer, course.year_label].filter(Boolean).join(' · ')}
      </p>
      <div className="flex justify-between text-xs text-muted">
        <span>{course.semester ? `סמסטר ${course.semester}` : ''}</span>
        <span className="text-brand">לקורס ←</span>
      </div>
    </Link>
  )
}
