import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Sparkles, X } from 'lucide-react'

interface ToastItem {
  id: number
  text: string
  tone: 'default' | 'success' | 'error'
  leaving: boolean
}

interface ToastApi {
  toast: (text: string, tone?: ToastItem['tone']) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** 停留时长要和 motion.css 里 .toast__bar 的动画时长对齐 */
const LIFETIME = 2400
const LEAVE = 200

const TONE_ICON = {
  default: Sparkles,
  success: Check,
  error: X,
} as const

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const toast = useCallback((text: string, tone: ToastItem['tone'] = 'default') => {
    const id = ++counter.current
    setItems((prev) => [...prev.slice(-2), { id, text, tone, leaving: false }])
    // 底边进度条走完 → 先播退场，再从列表里摘掉
    window.setTimeout(() => {
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, leaving: true } : item)))
      window.setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id))
      }, LEAVE)
    }, LIFETIME)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => {
          const Icon = TONE_ICON[item.tone]
          return (
            <div
              key={item.id}
              className={`toast toast--${item.tone}`}
              data-leaving={item.leaving ? 'true' : 'false'}
            >
              <span className="toast__icon">
                <Icon />
              </span>
              <span>{item.text}</span>
              <span className="toast__bar" aria-hidden="true" />
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}
