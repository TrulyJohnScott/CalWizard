/**
 * Stats view of the curve (spec §11): one row per concentration with its mean signal and SD. Shows the current curve
 * whatever defines it (data, stats or functions); typing a value makes these stats define it (one undo step).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { columnStats, fromTable, toTable } from '../math/table'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'

interface Row {
  c: number | null
  mean: number | null
  sd: number | null
}

const sig = (v: number) => +v.toPrecision(4)

function rowsOf(d: Derived): Row[] {
  const { series: s, model: m } = d
  if (s.mode === 'summary') return s.summary.map((r) => ({ c: r.c, mean: r.mean, sd: r.sd }))
  if (s.mode === 'replicates') {
    const t = toTable(s)
    const st = columnStats(t)
    return t.concs.map((c, j) => ({ c, mean: st[j]?.mean ?? t.typed[j]?.mean ?? null, sd: st[j]?.sd ?? t.typed[j]?.sd ?? null }))
  }
  return m.levels.map((c) => ({ c, mean: sig(m.mean(c)), sd: sig(m.sd(c)) }))
}

/** A number cell that may be empty; commits on Enter or leaving the cell. */
function Cell({ value, onCommit, label, readOnly }: { value: number | null; onCommit: (v: number | null) => void; label: string; readOnly?: boolean }) {
  const show = (v: number | null) => (v === null || !Number.isFinite(v) ? '' : String(v))
  const [text, setText] = useState(show(value))
  const focus = useRef(false)
  useEffect(() => {
    if (!focus.current) setText(show(value))
  }, [value])
  const commit = () => {
    const t = text.trim().replace(',', '.')
    const v = t === '' ? null : Number(t)
    if (v !== null && !Number.isFinite(v)) return setText(show(value))
    if (v !== value) onCommit(v)
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className="bare mono w-full text-right text-[12px]"
      value={text}
      readOnly={readOnly}
      onFocus={() => (focus.current = true)}
      onBlur={() => {
        focus.current = false
        commit()
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function StatsTable({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const setLadder = useStore((s) => s.setLadder)
  const clearMeasure = useStore((s) => s.clearMeasure)
  const notify = useStore((s) => s.notify)
  const rows = useMemo(() => rowsOf(d), [d])
  const driving = d.series.mode === 'summary'

  const commit = (next: Row[]) => {
    const kept = next.filter((r) => r.c !== null && Number.isFinite(r.c) && r.c >= 0)
    const byC = new Map<number, Row>()
    for (const r of kept) byC.set(r.c as number, r)
    const sorted = [...byC.values()].sort((a, b) => (a.c as number) - (b.c as number))
    clearMeasure()
    setLadder(null)
    patch(fromTable({ concs: sorted.map((r) => r.c), cells: sorted.map(() => []), typed: sorted.map((r) => ({ mean: r.mean, sd: r.sd })) }))
    if (!driving) notify('These stats now define the curve')
  }
  const all: Row[] = [...rows, { c: null, mean: null, sd: null }]
  const set = (i: number, key: keyof Row, v: number | null) => commit(all.map((r, j) => (j === i ? { ...r, [key]: v } : r)))
  const u = d.series.units

  return (
    <div className="flex flex-col gap-1.5">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-muted">
            <th className="pb-1 text-right font-normal">c{u ? ` (${u})` : ''}</th>
            <th className="pb-1 text-right font-normal">{d.series.signalLabel || 'signal'}</th>
            <th className="pb-1 text-right font-normal">SD</th>
          </tr>
        </thead>
        <tbody>
          {all.map((r, i) => (
            <tr key={i} className="border-t border-line">
              <td className="py-0.5 pr-2">
                <Cell value={r.c} label={`concentration, row ${i + 1}`} readOnly={i === 0 && r.c === 0} onCommit={(v) => set(i, 'c', v)} />
              </td>
              <td className="py-0.5 pr-2">
                <Cell value={r.mean} label={`mean signal, row ${i + 1}`} onCommit={(v) => set(i, 'mean', v)} />
              </td>
              <td className="py-0.5">
                <Cell value={r.sd} label={`SD, row ${i + 1}`} onCommit={(v) => set(i, 'sd', v)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="text-[11px] text-muted">
        SD of one reading. The last row adds a concentration; clear a concentration to remove its row.
      </span>
    </div>
  )
}
