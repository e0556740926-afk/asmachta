import { createContext, useContext, useState, type ReactNode } from 'react'
import { Sheet } from '../ui/Sheet'
import { t } from '../../i18n/he'

type AgentPanelCtx = { openAgent: (context?: string) => void }

const Ctx = createContext<AgentPanelCtx>({ openAgent: () => {} })

/**
 * Agent panel shell (M1-12): a single global Sheet instance any screen can
 * open via useAgentPanel(), optionally passing a label for what it was
 * opened from (e.g. a course title) so the panel shows the current
 * context. It has no AI wiring yet — that needs an AI API key plus real
 * content to answer from (M2+) — so it only shows an honest "coming soon"
 * placeholder for now.
 */
export function AgentPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<string | null>(null)

  function openAgent(ctx?: string) {
    setContext(ctx ?? null)
    setOpen(true)
  }

  return (
    <Ctx.Provider value={{ openAgent }}>
      {children}
      <Sheet open={open} onClose={() => setOpen(false)} title={t.agentPanel.title}>
        <div className="grid gap-3 text-sm">
          {context && (
            <p className="rounded-md bg-tint px-3 py-2 text-xs text-brand">
              {t.agentPanel.contextLabel}: {context}
            </p>
          )}
          <p className="font-medium">{t.agentPanel.comingSoonTitle}</p>
          <p className="text-muted">{t.agentPanel.comingSoonBody}</p>
        </div>
      </Sheet>
    </Ctx.Provider>
  )
}

export function useAgentPanel() {
  return useContext(Ctx)
}
