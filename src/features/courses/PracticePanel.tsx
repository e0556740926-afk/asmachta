import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { t } from '../../i18n/he'
import { CardsPanel } from './CardsPanel'
import { QuizzesPanel } from './QuizzesPanel'

export function PracticePanel({ courseId, courseTitle }: { courseId: string; courseTitle: string }) {
  const [mode, setMode] = useState<'cards' | 'quizzes'>('cards')

  return (
    <div className="grid gap-6">
      <div className="flex gap-2">
        <Button type="button" variant={mode === 'cards' ? 'primary' : 'quiet'} onClick={() => setMode('cards')}>
          {t.practice.cardsTab}
        </Button>
        <Button type="button" variant={mode === 'quizzes' ? 'primary' : 'quiet'} onClick={() => setMode('quizzes')}>
          {t.practice.quizzesTab}
        </Button>
      </div>
      {mode === 'cards' ? <CardsPanel courseId={courseId} courseTitle={courseTitle} /> : <QuizzesPanel courseId={courseId} courseTitle={courseTitle} />}
    </div>
  )
}
