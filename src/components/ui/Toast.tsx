import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Tone = 'default' | 'success' | 'error'
type ToastItem = { id: number; message: string; tone: Tone }
type ToastCtx = { show: (message: string, tone?: Tone) => void }

const Ctx = createContext<ToastCtx>({ show: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const show = useCallback((message: string, tone: Tone = 'default') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, tone }])
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3500)
  }, [])

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] mx-auto flex w-full max-w-sm flex-col gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg ${
              toast.tone === 'success'
                ? 'border-brand bg-tint text-brand'
                : toast.tone === 'error'
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : 'border-line bg-surface text-ink'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  return useContext(Ctx)
}
