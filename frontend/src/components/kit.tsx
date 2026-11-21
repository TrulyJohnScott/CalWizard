/** Shared pieces of the workspaces (spec §21): scrub fields, modal, stats, status dots, section headings. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fmt } from '../format'

/**
 * A number you can type, nudge with the arrow keys, or drag sideways on its label ("scrub"). Not a slider:
 * there is no track, the value is always the typed number (spec §11: no sliders).
 */
export function Scrub({
  label,
  value,
  onChange,
  step,
  min,
  max,
  width = 64,
  title,
  suffix,
  digits = 4,
  placeholder,
}: {
  label?: string
  value: number | null
  onChange: (v: number) => void
  /** change per pixel dragged and per arrow key press */
  step: number
  min?: number
  max?: number
  width?: number
  title?: string
  suffix?: string
  digits?: number
  placeholder?: string
}) {
  const show = (v: number | null) => (v === null || !Number.isFinite(v) ? '' : String(+v.toPrecision(digits)))
  const [text, setText] = useState(show(value))
  const focus = useRef(false)
  const last = useRef(value)
  useEffect(() => {
    // follow outside changes (Undo, another control) unless the user has typed something not yet committed
    if (!focus.current || text === show(last.current)) setText(show(value))
    last.current = value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  const commit = (t: string) => {
    const v = Number(t.trim().replace(',', '.'))
    if (t.trim() !== '' && Number.isFinite(v)) {
      const c = clamp(v)
      if (c !== value) onChange(c)
    } else setText(show(value))
  }
  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const x0 = e.clientX
    const v0 = value ?? 0
    document.body.style.cursor = 'ew-resize'
    const mv = (ev: PointerEvent) => onChange(clamp(+(v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 10 : 1)).toPrecision(6)))
    const up = () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
  }
  return (
    <label className="inline-flex items-center gap-1.5" title={title}>
      {label && (
        <span className="label cursor-ew-resize select-none" onPointerDown={drag}>
          {label}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        style={{ width, textAlign: 'right' }}
        onFocus={() => (focus.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focus.current = false
          commit(text)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const base = Number.isFinite(Number(text)) && text.trim() !== '' ? Number(text) : value ?? 0
            const next = clamp(+(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)).toPrecision(6))
            setText(show(next))
            onChange(next)
          }
        }}
      />
      {suffix && <span className="label">{suffix}</span>}
    </label>
  )
}

/** Centered dialog; Esc or a click outside closes it. */
export function Modal({ title, onClose, children, width = 720 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-6 pt-[8vh]" style={{ background: 'color-mix(in srgb, var(--bg) 70%, transparent)', backdropFilter: 'blur(3px)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pop w-full rounded-xl border border-line bg-panel shadow-xl" style={{ maxWidth: width }} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-[13.5px] font-semibold">{title}</span>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            Esc
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

/** One number with its name; `tone` colours the value. */
export function Stat({ label, value, sub, tone, title }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'accent'; title?: string }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : tone === 'accent' ? 'var(--accent)' : undefined
  return (
    <div className="min-w-0" title={title}>
      <div className="label truncate">{label}</div>
      <div className="truncate text-[17px] font-semibold leading-tight tracking-tight" style={{ color }}>
        {value}
      </div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
  )
}

export const Dot = ({ ok, size = 9 }: { ok: boolean | null; size?: number }) => (
  <span
    aria-label={ok === null ? 'unknown' : ok ? 'met' : 'not met'}
    style={{ width: size, height: size, borderRadius: size, display: 'inline-block', flexShrink: 0, background: ok === null ? 'var(--faint)' : ok ? 'var(--good)' : 'var(--bad)' }}
  />
)

/** Quiet section heading with an optional right-hand slot. */
export const Section = ({ title, right, children, hint }: { title: string; right?: ReactNode; children: ReactNode; hint?: string }) => (
  <section className="border-t border-line pt-4">
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h3 className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted" title={hint}>
        {title}
      </h3>
      {right}
    </div>
    {children}
  </section>
)

/** The page frame every non-curve workspace uses: centred column, generous air. */
export const Page = ({ children, width = 1040 }: { children: ReactNode; width?: number }) => (
  <main className="min-w-0 flex-1 overflow-y-auto">
    <div className="fade mx-auto flex flex-col gap-5 px-6 py-6" style={{ maxWidth: width }}>
      {children}
    </div>
  </main>
)

/** Headline sentence + supporting line. */
export const Verdict = ({ ok, children, sub }: { ok?: boolean | null; children: ReactNode; sub?: ReactNode }) => (
  <div>
    <h2 className="m-0 flex items-center gap-2.5 text-[22px] font-semibold leading-snug tracking-tight">
      {ok !== undefined && <Dot ok={ok} size={11} />}
      <span>{children}</span>
    </h2>
    {sub && <p className="m-0 mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">{sub}</p>}
  </div>
)

export const num = (x: number | null | undefined, d = 3) => fmt(x, d)

const P = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
export const IconShare = () => (
  <svg {...P}>
    <path d="M8 10V2.5M5.2 5L8 2.2 10.8 5M3 9v3.5a1 1 0 001 1h8a1 1 0 001-1V9" />
  </svg>
)
export const IconPlay = () => (
  <svg {...P}>
    <path d="M5 3.2v9.6L12.5 8z" />
  </svg>
)
export const IconWand = () => (
  <svg {...P}>
    <path d="M3 13L11 5M10 2.5v2M10 7.5v0M13.5 6h-2M7.5 4.5l0 0M12.5 3.5l-.7.7" />
  </svg>
)
export const IconGrid = () => (
  <svg {...P}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </svg>
)
