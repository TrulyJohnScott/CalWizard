import { useEffect } from 'react'
import { useStore } from '../state/store'

const SHOW_MS = 6000
const PLAIN_MS = 3200

/** "<what happened> · Undo" at the bottom centre after a one-click change (spec section 11, v2.3). */
export function Toast() {
  const toast = useStore((s) => s.toast)
  const undo = useStore((s) => s.undo)
  const dismiss = useStore((s) => s.dismissToast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismiss, toast.undo === false ? PLAIN_MS : SHOW_MS)
    return () => clearTimeout(t)
  }, [toast, dismiss])
  if (!toast) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center" role="status" aria-live="polite">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-1.5 text-[12.5px] shadow-sm">
        <span>{toast.text}</span>
        {toast.undo !== false && (
          <button
            className="link"
            onClick={() => {
              if (toast.undo) {
                toast.undo()
                dismiss()
              } else undo()
            }}
          >
            Undo
          </button>
        )}
      </div>
    </div>
  )
}
