/**
 * Right column (core design): measured values to concentrations (spec §18). Type or paste signals; each row gives the
 * concentration, its range and a flag. Clicking a row puts its reading line on the curve.
 */
import { useMemo, useState } from 'react'
import { fmt } from '../format'
import { FLAG_TEXT, readback } from '../math/readback'
import { parseNum } from '../math/tables'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { IconX } from './ui'

const rangeOf = (lo: number | null, hi: number | null) => (lo === null || hi === null ? '' : `${fmt(lo)} – ${fmt(hi)}`)

export function ReadPanel({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const reading = useStore((s) => s.reading)
  const setReading = useStore((s) => s.setReading)
  const [text, setText] = useState('')
  const { series: s, model: m } = d
  const samples = s.samples ?? []
  const res = useMemo(() => {
    try {
      return readback(m, samples, s.limits)
    } catch {
      return null
    }
  }, [m, samples, s.limits])

  const add = () => {
    const vals = text
      .split(/[\n\r\t,;]+/)
      .map((x) => {
        const m = /^\s*([^x×*]+?)\s*(?:[x×*]\s*(\d+))?\s*$/i.exec(x)
        const signal = m ? parseNum(m[1]) : null
        return signal !== null && Number.isFinite(signal) ? { id: '', signal, dilution: 1, strips: m?.[2] ? Math.max(1, Number(m[2])) : 1 } : null
      })
      .filter((v): v is { id: string; signal: number; dilution: number; strips: number } => v !== null)
    if (!vals.length) return
    patch({ samples: [...samples, ...vals] })
    setText('')
    setReading(vals[vals.length - 1].signal)
  }
  const remove = (i: number) => patch({ samples: samples.filter((_, j) => j !== i) })
  const u = s.units

  return (
    <aside className="flex w-1/4 min-w-[220px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-line p-3">
      <span className="label">Read values</span>
      <textarea
        className="mono w-full resize-y rounded border border-line bg-transparent p-2 text-[12px]"
        rows={2}
        placeholder={`${s.signalLabel || 'signal'} values, one per line (720×3 = mean of 3 strips)`}
        aria-label="Signals to read back"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            add()
          }
        }}
        onPaste={(e) => {
          e.stopPropagation() // a pasted column lands here, not in the curve's data
        }}
      />
      {samples.length === 0 ? (
        <p className="m-0 text-[12px] leading-relaxed text-muted">
          Type a measured signal and press Enter: you get the concentration, the range it could really be, and a warning when it can’t be trusted (below the LoD, above the range, past the hook). Paste a whole column at once; <span className="mono">720×3</span> means the mean of 3 strips.
        </p>
      ) : (
        <span className="text-[11px] text-muted">Click a value to see it on the curve.</span>
      )}
      {res && res.rows.length > 0 && (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-muted">
              <th className="pb-1 text-left font-normal">{s.signalLabel || 'signal'}</th>
              <th className="pb-1 text-right font-normal">c{u ? ` (${u})` : ''}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {res.rows.map((r, i) => {
              const on = reading !== null && r.signal === reading
              const flag = r.flag === 'ok' ? '' : FLAG_TEXT[r.flag]
              const warn = r.flag === 'hook' || r.flag === 'above' || r.flag === 'below' || r.flag === 'invalid'
              return (
                <tr key={i} className="group cursor-pointer border-t border-line align-top" style={on ? { background: 'var(--hover)' } : undefined} onClick={() => setReading(r.signal)} title="Show this reading on the curve">
                  <td className="py-1 pr-2">
                    {fmt(r.signal, 4)}
                    {(samples[i]?.strips ?? 1) > 1 && <span className="text-muted"> ×{samples[i].strips}</span>}
                  </td>
                  <td className="py-1 text-right">
                    <b>{r.c === null ? '–' : fmt(r.c)}</b>
                    {rangeOf(r.lo, r.hi) && <div className="text-[11px] text-muted">{rangeOf(r.lo, r.hi)}</div>}
                    {flag && <div className="text-[11px]" style={{ color: warn ? 'var(--bad)' : 'var(--warm)' }}>{flag}</div>}
                  </td>
                  <td className="w-5 py-1 pl-1">
                    <button
                      className="btn ghost text-faint opacity-0 group-hover:opacity-100"
                      style={{ height: 18, padding: '0 3px' }}
                      aria-label="Remove this value"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(i)
                      }}
                    >
                      <IconX />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {samples.length > 0 && (
        <button className="link self-start text-[11.5px]" onClick={() => patch({ samples: [] })}>
          clear all
        </button>
      )}
    </aside>
  )
}
