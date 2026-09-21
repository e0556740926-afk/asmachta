import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, StatusChip, Skeleton, Num } from '../../components/ui/Primitives'
import { Select, type SelectOption } from '../../components/ui/Select'
import { Dialog } from '../../components/ui/Dialog'
import { Sheet } from '../../components/ui/Sheet'
import { useToast } from '../../components/ui/Toast'
import { Stepper } from '../../components/ui/Stepper'
import { TreeRow } from '../../components/ui/TreeRow'
import { Tooltip } from '../../components/ui/Tooltip'
import { Popover } from '../../components/ui/Popover'
import { CitationChip } from '../../components/ui/CitationChip'
import { t } from '../../i18n/he'

const SELECT_OPTIONS: SelectOption[] = [
  { value: 'brand', label: 'ירוק' },
  { value: 'gold', label: 'זהב' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="grid gap-4">
      <h2 className="font-display text-base font-medium">{title}</h2>
      {children}
    </Card>
  )
}

export function DesignPage() {
  const [selectValue, setSelectValue] = useState<string | null>('brand')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [treeExpanded, setTreeExpanded] = useState(true)
  const { show } = useToast()

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 pb-24 md:px-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-medium">{t.design.title}</h1>
        <p className="text-sm text-muted">{t.design.subtitle}</p>
      </div>

      <div className="grid gap-6">
        <Section title={t.design.buttons}>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary">Primary</Button>
            <Button>Default</Button>
            <Button variant="quiet">Quiet</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title={t.design.chips}>
          <div className="flex flex-wrap gap-2">
            <StatusChip tone="brand">Brand</StatusChip>
            <StatusChip tone="gold">Gold</StatusChip>
            <StatusChip tone="pending">Pending</StatusChip>
            <StatusChip>Default</StatusChip>
          </div>
        </Section>

        <Section title={t.design.citation}>
          <div className="flex flex-wrap gap-2">
            <CitationChip>ע"א 1234/20</CitationChip>
            <CitationChip onClick={() => show(t.design.toastMessage, 'success')}>ס' 12 לחוק החוזים</CitationChip>
          </div>
        </Section>

        <Section title={t.design.select}>
          <div className="max-w-xs">
            <Select value={selectValue} onChange={setSelectValue} options={SELECT_OPTIONS} />
          </div>
        </Section>

        <Section title="Dialog / Sheet">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setDialogOpen(true)}>{t.design.dialogOpen}</Button>
            <Button onClick={() => setSheetOpen(true)}>{t.design.sheetOpen}</Button>
          </div>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title={t.design.dialogTitle}
            footer={<Button variant="primary" onClick={() => setDialogOpen(false)}>{t.design.dialogClose}</Button>}
          >
            <p className="text-sm text-muted">{t.design.dialogBody}</p>
          </Dialog>
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t.design.sheetTitle}>
            <p className="text-sm text-muted">{t.design.sheetBody}</p>
          </Sheet>
        </Section>

        <Section title={t.design.toast}>
          <Button onClick={() => show(t.design.toastMessage, 'success')}>{t.design.toastShow}</Button>
        </Section>

        <Section title={t.design.stepper}>
          <Stepper steps={['פרטים', 'העלאה', 'סקירה', 'סיום']} current={step} />
          <div className="flex gap-2">
            <Button onClick={() => setStep((s) => Math.max(0, s - 1))}>הקודם</Button>
            <Button onClick={() => setStep((s) => Math.min(3, s + 1))}>הבא</Button>
          </div>
        </Section>

        <Section title={t.design.tree}>
          <div>
            <TreeRow
              label="חלק א' — עקרונות יסוד"
              hasChildren
              expanded={treeExpanded}
              onToggle={() => setTreeExpanded((v) => !v)}
            />
            {treeExpanded && (
              <>
                <TreeRow label="1. כריתת חוזה" depth={1} />
                <TreeRow label="2. פגמים בכריתה" depth={1} />
              </>
            )}
          </div>
        </Section>

        <Section title={t.design.tooltip}>
          <Tooltip label={t.design.tooltipLabel}>
            <Button>{t.design.tooltipTrigger}</Button>
          </Tooltip>
        </Section>

        <Section title={t.design.popover}>
          <Popover
            trigger={({ toggle }) => (
              <Button onClick={toggle}>{t.design.popoverTrigger}</Button>
            )}
          >
            <button className="block w-full rounded-md px-3 py-2 text-start text-sm hover:bg-soft">אפשרות 1</button>
            <button className="block w-full rounded-md px-3 py-2 text-start text-sm hover:bg-soft">אפשרות 2</button>
          </Popover>
        </Section>

        <Section title="Empty state / Skeleton / Num">
          <EmptyState title="אין פריטים להצגה" />
          <Skeleton className="h-4 w-full" />
          <p className="text-sm">
            צוטט ב-<Num>ע"א 1234/20</Num>
          </p>
        </Section>
      </div>
    </div>
  )
}
