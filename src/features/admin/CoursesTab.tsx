import { useEffect, useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase, type Course } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, StatusChip } from '../../components/ui/Primitives'
import { t } from '../../i18n/he'

type FormState = {
  id: string | null
  title: string
  lecturer: string
  institution: string
  year_label: string
  semester: string
  exam_date: string
  color: 'brand' | 'gold'
}

const emptyForm: FormState = {
  id: null,
  title: '',
  lecturer: '',
  institution: '',
  year_label: '',
  semester: '',
  exam_date: '',
  color: 'brand',
}

function SortableCourseRow({
  course,
  onEdit,
  onToggleArchive,
}: {
  course: Course
  onEdit: () => void
  onToggleArchive: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: course.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between gap-3 border-b border-line bg-surface py-3 last:border-0"
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label={t.admin.courses.dragHandle}
          className="shrink-0 touch-none cursor-grab text-muted hover:text-ink active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <div className="min-w-0">
          <p className="truncate font-medium">
            {course.title} {course.archived && <StatusChip>{t.admin.courses.archived}</StatusChip>}
          </p>
          <p className="truncate text-xs text-muted">
            {course.lecturer} · {course.year_label} {course.semester ? `· סמסטר ${course.semester}` : ''}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button onClick={onEdit}>{t.admin.courses.edit}</Button>
        <Button onClick={onToggleArchive}>
          {course.archived ? t.admin.courses.unarchive : t.admin.courses.archive}
        </Button>
      </div>
    </div>
  )
}

export function CoursesTab() {
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  async function load() {
    const { data } = await supabase.from('courses').select('*').order('position')
    setCourses((data as Course[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  function startNew() {
    setForm({ ...emptyForm })
  }

  function startEdit(c: Course) {
    setForm({
      id: c.id,
      title: c.title,
      lecturer: c.lecturer ?? '',
      institution: c.institution ?? '',
      year_label: c.year_label ?? '',
      semester: c.semester ?? '',
      exam_date: c.exam_date ?? '',
      color: (c.color as 'brand' | 'gold') ?? 'brand',
    })
  }

  async function submit() {
    if (!form || !form.title.trim()) return
    setBusy(true)
    const payload = {
      title: form.title.trim(),
      lecturer: form.lecturer.trim() || null,
      institution: form.institution.trim() || null,
      year_label: form.year_label.trim() || null,
      semester: form.semester.trim() || null,
      exam_date: form.exam_date || null,
      color: form.color,
    }
    if (form.id) {
      await supabase.from('courses').update(payload).eq('id', form.id)
    } else {
      await supabase.from('courses').insert({ ...payload, position: (courses?.length ?? 0) + 1 })
    }
    setBusy(false)
    setForm(null)
    load()
  }

  async function toggleArchive(c: Course) {
    await supabase.from('courses').update({ archived: !c.archived }).eq('id', c.id)
    load()
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id || !courses) return
    const oldIndex = courses.findIndex((c) => c.id === active.id)
    const newIndex = courses.findIndex((c) => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(courses, oldIndex, newIndex)
    setCourses(reordered)
    await Promise.all(reordered.map((c, i) => supabase.from('courses').update({ position: i + 1 }).eq('id', c.id)))
  }

  if (courses === null) return null

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-medium">{t.courses.title}</h2>
        {!form && (
          <Button variant="primary" onClick={startNew}>
            {t.admin.courses.newCourse}
          </Button>
        )}
      </div>

      {form && (
        <Card className="grid gap-4">
          <h3 className="font-display text-base font-medium">
            {form.id ? t.admin.courses.editCourse : t.admin.courses.newCourse}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm sm:col-span-2">
              {t.admin.courses.title}
              <input
                className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t.admin.courses.lecturer}
              <input
                className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
                value={form.lecturer}
                onChange={(e) => setForm({ ...form, lecturer: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t.admin.courses.institution}
              <input
                className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t.admin.courses.yearLabel}
              <input
                className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
                value={form.year_label}
                onChange={(e) => setForm({ ...form, year_label: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t.admin.courses.semester}
              <input
                className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
                value={form.semester}
                onChange={(e) => setForm({ ...form, semester: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t.admin.courses.examDate}
              <input
                type="date"
                className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
                value={form.exam_date}
                onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t.admin.courses.color}
              <select
                className="rounded-md border border-line bg-bg px-3 py-2 text-ink"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value as 'brand' | 'gold' })}
              >
                <option value="brand">{t.admin.courses.colorBrand}</option>
                <option value="gold">{t.admin.courses.colorGold}</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy || !form.title.trim()} onClick={submit}>
              {t.admin.courses.save}
            </Button>
            <Button onClick={() => setForm(null)}>{t.admin.courses.cancel}</Button>
          </div>
        </Card>
      )}

      {courses.length === 0 && !form ? (
        <EmptyState title={t.admin.courses.empty} />
      ) : (
        <>
          <p className="text-xs text-muted">{t.admin.courses.dragHint}</p>
          <Card>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={courses.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {courses.map((c) => (
                  <SortableCourseRow
                    key={c.id}
                    course={c}
                    onEdit={() => startEdit(c)}
                    onToggleArchive={() => toggleArchive(c)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </Card>
        </>
      )}
    </div>
  )
}
