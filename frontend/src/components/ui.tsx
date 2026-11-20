import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Seg<T extends string>({ value, options, onChange, title }: { value: T; options: ([T, string] | [T, string, string])[]; onChange: (v: T) => void; title?: string }) {
  return (
    <div className="inline-flex shrink-0 rounded-md border border-line p-px" role="tablist" title={title}>
      {options.map(([k, label, tip]) => (
        <button
          key={k}
          title={tip}
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={`h-[22px] cursor-pointer whitespace-nowrap rounded-[5px] border-0 px-2 text-[12px] ${value === k ? 'bg-hover text-fg' : 'bg-transparent text-muted hover:text-fg'}`}
          style={value === k ? { boxShadow: 'inset 0 0 0 1px var(--line)' } : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Numeric text field: typing, Enter/blur commit, arrow keys nudge (Shift = x10). No spinner, no slider. */
export function NumField({
  value,
  onCommit,
  step = 1,
  min,
  max,
  width = 56,
  title,
}: {
  value: number
  onCommit: (v: number) => void
  step?: number
  min?: number
  max?: number
  width?: number
  title?: string
}) {
  const [text, setText] = useState(String(value))
  const focus = useRef(false)
  useEffect(() => {
    if (!focus.current) setText(String(value))
  }, [value])
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  const commit = (t: string) => {
    const v = Number(t.trim().replace(',', '.'))
    if (t.trim() !== '' && Number.isFinite(v)) {
      const c = clamp(v)
      if (c !== value) onCommit(c)
      return c
    }
    return value
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      title={title}
      value={text}
      style={{ width, textAlign: 'right' }}
      onFocus={() => (focus.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focus.current = false
        setText(String(commit(text)))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setText(String(commit(text)))
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const cur = Number(text.replace(',', '.'))
          const base = Number.isFinite(cur) ? cur : value
          const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
          const next = clamp(parseFloat((base + d).toPrecision(12)))
          setText(String(next))
          if (next !== value) onCommit(next)
        }
      }}
    />
  )
}

/** Click-outside popover. */
export function Popover({ trigger, children, align = 'right' }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className={`absolute top-[30px] z-30 w-[260px] rounded-lg border border-line bg-panel p-3 ${align === 'right' ? 'right-0' : 'left-0'}`}>{children}</div>
      )}
    </div>
  )
}

export const Row = ({ label, children, title }: { label: string; children: ReactNode; title?: string }) => (
  <div className="flex h-7 items-center justify-between gap-2" title={title}>
    <span className="text-muted">{label}</span>
    {children}
  </div>
)

const P = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
export const IconGear = () => (
  <svg {...P}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
  </svg>
)
export const IconChevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg {...P}>
    <path d={dir === 'left' ? 'M10 3.5L5.5 8l4.5 4.5' : 'M6 3.5L10.5 8 6 12.5'} />
  </svg>
)
export const IconX = () => (
  <svg {...P} width={10} height={10}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </svg>
)
export const IconPlus = () => (
  <svg {...P} width={10} height={10}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)
export const IconPin = () => (
  <svg {...P} width={11} height={11}>
    <path d="M9.5 2.5l4 4-2 .5-2.5 2.5.3 3-1 1L4.7 8.8 2 11.5l-.5-.5 2.7-2.7L1.5 6.5l1-1 3 .3L8.3 3.3z" />
  </svg>
)
export const IconUndo = () => (
  <svg {...P}>
    <path d="M5.5 4L2.5 7l3 3" />
    <path d="M2.8 7h6.7a3.5 3.5 0 010 7H7" />
  </svg>
)
export const IconRedo = () => (
  <svg {...P}>
    <path d="M10.5 4l3 3-3 3" />
    <path d="M13.2 7H6.5a3.5 3.5 0 000 7H9" />
  </svg>
)
