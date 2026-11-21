/**
 * Your concentrations as a typed list (core design), above the chart: "2, 5, 10×3, 25, 40". 0 is always the first
 * point and need not be typed; "×n" gives that point its own number of strips. Alt+click and dragging edit the same list.
 */
import { useEffect, useRef, useState } from 'react'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { Scrub } from './kit'

const show = (pts: { c: number; strips: number | null }[]) => pts.map((p) => `${p.c}${p.strips ? `×${p.strips}` : ''}`).join(', ')

export function parsePoints(text: string): { c: number; strips: number | null }[] | null {
  const out = new Map<number, number | null>()
  for (const tok of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*\.?\d+(?:e[-+]?\d+)?)(?:[x×*](\d+))?$/i.exec(tok.replace(',', '.'))
    if (!m) return null
    const c = Number(m[1])
    if (!(c >= 0) || !Number.isFinite(c)) return null
    if (c > 0) out.set(c, m[2] ? Math.max(1, Number(m[2])) : null)
  }
  return [...out].sort((a, b) => a[0] - b[0]).map(([c, strips]) => ({ c, strips }))
}

export function PointsField({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const pts = d.series.points ?? []
  const [text, setText] = useState(show(pts))
  const [bad, setBad] = useState(false)
  const focus = useRef(false)
  useEffect(() => {
    if (!focus.current) setText(show(pts))
  }, [pts])
  const commit = () => {
    const next = parsePoints(text)
    if (!next) return setBad(true)
    setBad(false)
    if (show(next) !== show(pts)) patch({ points: next })
  }
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5">
        <span className="label">your concentrations 0,</span>
        <input
          type="text"
          className="bare mono text-[12px]"
          style={{ width: 200, color: bad ? 'var(--bad)' : undefined }}
          placeholder="2, 5, 10×3, 25, 40"
          title="Type the concentrations you evaluate, separated by commas; 10×3 measures 10 with 3 strips. Enter to apply."
          value={text}
          onFocus={() => (focus.current = true)}
          onBlur={() => {
            focus.current = false
            commit()
          }}
          onChange={(e) => {
            setText(e.target.value)
            setBad(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <Scrub
        label="strips"
        value={d.series.limits.reads}
        step={0.05}
        min={1}
        max={100}
        width={34}
        onChange={(v) => patch({ limits: { ...d.series.limits, reads: Math.max(1, Math.round(v)) } })}
        title="Strips averaged per result, for every concentration without its own ×n"
      />
    </div>
  )
}
