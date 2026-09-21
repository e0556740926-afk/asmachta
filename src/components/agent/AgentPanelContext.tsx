import { createContext, useContext, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Sheet } from '../ui/Sheet'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { t } from '../../i18n/he'

type ChatMessage = { role: 'user' | 'model'; content: string }
type AgentPanelCtx = { openAgent: (context?: string) => void }

const Ctx = createContext<AgentPanelCtx>({ openAgent: () => {} })

async function extractErrorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response })?.context
  if (!context || typeof context.json !== 'function') return null
  try {
    const body = await context.json()
    return typeof body?.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

function errorMessage(code: string | null): string {
  switch (code) {
    case 'not_configured':
      return t.agentPanel.errorNotConfigured
    case 'not_active':
      return t.agentPanel.errorNotActive
    case 'quota_exceeded':
      return t.agentPanel.errorQuota
    default:
      return t.agentPanel.errorGeneric
  }
}

/**
 * Agent panel (M1-12 + Gemini wiring): a global Sheet any screen can open via useAgentPanel(),
 * optionally passing a label for what it was opened from (e.g. a course title). Sends chat
 * turns to the `agent-chat` Supabase Edge Function, which proxies to Google's Gemini API using a
 * server-side key. No RAG over course content yet — see the function's system instruction.
 */
export function AgentPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  function openAgent(ctx?: string) {
    setContext(ctx ?? null)
    setMessages([])
    setError(null)
    setInput('')
    setOpen(true)
  }

  async function onSend(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return
    const history = messages
    const next: ChatMessage[] = [...history, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setError(null)
    setSending(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const { data, error: invokeError } = await supabase.functions.invoke('agent-chat', {
        body: { message: text, context, history },
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      })
      if (invokeError) {
        const code = await extractErrorCode(invokeError)
        setError(errorMessage(code))
        return
      }
      const reply = (data as { reply?: string } | null)?.reply
      if (!reply) {
        setError(t.agentPanel.errorGeneric)
        return
      }
      setMessages((prev) => [...prev, { role: 'model', content: reply }])
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
    } catch {
      setError(t.agentPanel.errorGeneric)
    } finally {
      setSending(false)
    }
  }

  return (
    <Ctx.Provider value={{ openAgent }}>
      {children}
      <Sheet open={open} onClose={() => setOpen(false)} title={t.agentPanel.title}>
        <div className="flex h-full flex-col gap-3">
          {context && (
            <p className="shrink-0 rounded-md bg-tint px-3 py-2 text-xs text-brand">
              {t.agentPanel.contextLabel}: {context}
            </p>
          )}
          <div ref={scrollRef} className="grid flex-1 content-start gap-2 overflow-auto">
            {messages.length === 0 && <p className="text-sm text-muted">{t.agentPanel.intro}</p>}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'self-end bg-brand text-surface' : 'self-start bg-soft text-ink'
                }`}
              >
                {m.content}
              </div>
            ))}
            {sending && <p className="self-start text-xs text-muted">{t.agentPanel.thinking}</p>}
          </div>
          {error && <p className="shrink-0 text-sm text-red-600">{error}</p>}
          <form onSubmit={onSend} className="flex shrink-0 gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.agentPanel.placeholder}
              disabled={sending}
            />
            <Button type="submit" variant="primary" disabled={sending || !input.trim()}>
              {t.agentPanel.send}
            </Button>
          </form>
        </div>
      </Sheet>
    </Ctx.Provider>
  )
}

export function useAgentPanel() {
  return useContext(Ctx)
}
