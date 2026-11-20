import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, pct } from '../format'
import { ladder as makeLadder, pairRow, pairRows, whyNot } from '../math/analysis'
import { closenessColor, closenessQ, rgbaCss } from '../math/closeness'
import { METRIC_LABEL } from '../math/metrics'
import { normLevels, parseNum } from '../math/tables'
import type { Derived } from '../state/derived'
import { isPending, rulerPoints, useStore } from '../state/store'
import { ExperimentPanel } from './ExperimentPanel'
import { IconChevron, IconX, Seg } from './ui'

const GRID = '56px 1fr 1fr 1fr 16px'

function LevelInput({ value, onCommit }: { value: number; onCommit: (v: number | null) => void }) {
  const [t, setT] = useState(String(value))
  const f = useRef(false)
  useEffect(() => {
    if (!f.current) setT(String(value))
  }, [value])
  const done = () => {
    f.current = false
    const v = parseNum(t)
    if (t.trim() === '') onCommit(null)
    else if (v !== null && v >= 0 && v !== value) onCommit(v)
    else setT(String(value))
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      className="bare w-full"
      style={{ height: 22 }}
      value={t}
      onFocus={() => (f.current = true)}
      onChange={(e) => setT(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function LevelsSidebar({ d }: { d: Derived }) {
  const open = useStore((s) => s.ui.sidebar)
  const setUi = useStore((s) => s.setUi)
  const patch = useStore((s) => s.patch)
  const setFocus = useStore((s) => s.setFocus)
  const lad = useStore((s) => s.ladder)
  const setLadder = useStore((s) => s.setLadder)
  const applyLadder = useStore((s) => s.applyLadder)
  const notify = useStore((s) => s.notify)
  const measure = useStore((s) => s.measure)
  const expOpen = useStore((s) => s.exp.open)
  const setExp = useStore((s) => s.setExp)
  const clearMeasure = useStore((s) => s.clearMeasure)
  const keepMeasure = useStore((s) => s.keepMeasure)
  const popMeasure = useStore((s) => s.popMeasure)
  const probe = useStore((s) => (isPending(s.measure) ? s.probe : null))
  const [add, setAdd] = useState('')
  const { series: s, model: m, listed } = d
  const editable = s.mode === 'equations' && !lad?.list
  const metricName = METRIC_LABEL[s.metric]
  const rows = pairRows(m, listed, s.metric, s.kTarget)

  // ruler readout: every adjacent pair of the placed points (the next point previewed live while only one is placed)
  const pts = useMemo(() => rulerPoints(measure, probe), [measure, probe])
  const committed = !!measure && measure.pts.length >= 2
  const rulerRows = useMemo(
    () =>
      pts.slice(1).map((c2, i) => {
        const c1 = pts[i]
        const r = pairRow(m, c1, c2, s.metric, s.kTarget)
        const steps = makeLadder({ mean: m.mean, sd: m.sd, cMax: c2 }, s.metric, s.kTarget, 0, 200, c1).length - 1
        return { ...r, steps }
      }),
    [pts, m, s.metric, s.kTarget],
  )

  if (!open)
    return (
      <aside className="flex w-8 shrink-0 flex-col items-center border-l border-line pt-2">
        <button className="btn ghost" style={{ padding: '0 4px' }} onClick={() => setUi({ sidebar: true })} title="Show levels">
          <IconChevron dir="left" />
        </button>
        <span className="label mt-3 select-none" style={{ writingMode: 'vertical-rl' }}>
          Levels
        </span>
      </aside>
    )

  const setLevels = (levels: number[]) => {
    const oldMax = listed[listed.length - 1]
    const newMax = levels[levels.length - 1]
    patch({ levels, ...(newMax > 0 && (s.cMax === oldMax || newMax > s.cMax) ? { cMax: newMax } : {}) })
    setLadder(null)
  }
  const edit = (i: number, v: number | null) => {
    setLevels(normLevels(listed.filter((_, k) => k !== i).concat(v === null ? [] : [v])))
    if (v === null) notify(`Removed level ${fmt(listed[i], 4)}`)
  }
  const doAdd = () => {
    const v = parseNum(add)
    if (v !== null && v >= 0) setLevels(normLevels([...listed, v]))
    setAdd('')
  }
  const runLadder = () => {
    applyLadder(d.resolvable)
    if (s.mode === 'equations') notify(`Levels set to the ladder (${d.resolvable.length})`)
  }


  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-line">
      <div className="sticky top-0 z-10 border-b border-line bg-bg">
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <button className="btn ghost" style={{ padding: '0 4px' }} onClick={() => setUi({ sidebar: false })} title="Hide levels">
            <IconChevron dir="right" />
          </button>
          <Seg<'levels' | 'exp'>
            value={expOpen ? 'exp' : 'levels'}
            options={[
              ['levels', 'Levels', 'Separation of the levels from the curves on the left (the truth)'],
              ['exp', 'Experiment', 'Simulate experiments of n readings per level: what could a real run show?'],
            ]}
            onChange={(v) => setExp({ open: v === 'exp' })}
          />
        </div>
        {measure && (
          <div className="px-3 pb-2 text-[12px]">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-muted">
                {measure.pts.length === 1 ? `${fmt(measure.pts[0])} → click more points` : `${measure.pts.length} points (+ blank)`}
              </span>
              <span className="flex items-center gap-1">
                {committed && s.mode === 'equations' && !lad?.list && measure.pts.some((p) => !listed.includes(p)) && (
                  <button
                    className="link text-[11px]"
                    onClick={() => {
                      keepMeasure()
                      notify(`Kept ${measure.pts.length} ruler points as levels`)
                    }}
                    title="Add every ruler point to the levels"
                  >
                    Keep as levels
                  </button>
                )}
                <button className="btn ghost text-[11px]" style={{ height: 18, padding: '0 4px' }} onClick={popMeasure} title="Remove the last point placed (Backspace)">
                  ↶
                </button>
                <button className="btn ghost" style={{ height: 18, padding: '0 4px' }} onClick={clearMeasure} title="Clear all points (Esc)">
                  <IconX />
                </button>
              </span>
            </div>
            <div className="mb-1 text-[10.5px] text-faint">click to add · click a point to remove · Backspace: last · Esc: all</div>
            {rulerRows.length > 0 && (
              <>
                <div className="grid text-[10.5px] text-muted" style={{ gridTemplateColumns: '1fr 52px 44px 44px 30px' }}>
                  <span>pair</span>
                  <span className="text-right">{metricName}</span>
                  <span className="text-right">overlap</span>
                  <span className="text-right" title="misclassification rate for a single reading">
                    misread
                  </span>
                  <span className="text-right" title="resolvable steps between the two">
                    steps
                  </span>
                </div>
                {rulerRows.map((r, i) => (
                  <div
                    key={i}
                    className="grid items-center text-[11.5px]"
                    style={{ gridTemplateColumns: '1fr 52px 44px 44px 30px', height: 20, color: committed ? undefined : 'var(--muted)' }}
                  >
                    <span className="truncate">
                      {fmt(r.c1, 3)} → {fmt(r.c2, 3)}
                    </span>
                    <span className="text-right" style={{ color: r.pass ? 'var(--accent)' : 'var(--bad)' }}>
                      {fmt(r[s.metric])}
                    </span>
                    <span className="text-right text-muted">{pct(r.ovl)}</span>
                    <span className="text-right text-muted">{pct(r.err)}</span>
                    <span className="text-right">{r.steps}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {expOpen ? (
        <ExperimentPanel d={d} />
      ) : (
      <>
      <div className="px-3 pt-2">
        <div className="grid items-center text-[11px] text-muted" style={{ gridTemplateColumns: GRID, height: 20 }}>
          <span>c</span>
          <span className="text-right" title="difference of means to the previous row">
            Δμ
          </span>
          <span className="text-right">{metricName}</span>
          <span className="text-right" title="overlap with the previous row">
            ovl
          </span>
          <span />
        </div>
        {listed.map((c, i) => {
          const r = i > 0 ? rows[i - 1] : null
          const col = r ? closenessColor(closenessQ(r, s.metric, s.kTarget)) : null
          const hot = col !== null && col[3] > 0.01
          const measured = committed && measure !== null && measure.pts.includes(c)
          const why = r && !r.pass ? whyNot({ mean: m.mean, sd: m.sd, cMax: m.cMax }, r.c1, r.c2, s.metric, s.kTarget) : null
          return (
            <div key={`${i}`}>
            <div
              className={`group grid items-center border-t border-line text-[11.5px] ${i > 0 ? 'cursor-zoom-in' : ''}`}
              title={i > 0 ? 'Click to zoom both charts to this pair' : undefined}
              onClick={(e) => {
                if (i === 0 || (e.target as Element).closest('input,button')) return
                const a = listed[i - 1]
                const pad = 0.35 * (c - a)
                setFocus([Math.max(0, a - pad), c + pad])
              }}
              style={{
                gridTemplateColumns: GRID,
                height: 24,
                boxShadow: [hot ? `inset 3px 0 0 ${rgbaCss(col, 1.4)}` : '', measured ? 'inset 0 0 0 1px var(--accent)' : ''].filter(Boolean).join(',') || undefined,
                background: hot ? rgbaCss(col, 0.16) : undefined,
              }}
            >
              {i === 0 || !editable ? <span className="pl-2">{fmt(c, 4)}</span> : <LevelInput value={c} onCommit={(v) => edit(i, v)} />}
              <span className="text-right text-muted">{r ? fmt(r.dmu) : ''}</span>
              <span className="relative text-right" style={r ? { color: r.pass ? 'var(--accent)' : 'var(--bad)' } : undefined}>
                {r && col && (
                  // heat bar: length = closeness q (full at q ≥ 2), colour = the closeness colour
                  <span
                    className="absolute bottom-[3px] right-0 h-[2px] rounded-full"
                    style={{ width: `${Math.min(100, 50 * closenessQ(r, s.metric, s.kTarget))}%`, background: rgbaCss([col[0], col[1], col[2], 1]) }}
                  />
                )}
                {r ? fmt(r[s.metric]) : ''}
              </span>
              <span className="text-right text-muted">{r ? pct(r.ovl) : ''}</span>
              <span className="flex justify-end">
                {i > 0 && editable && (
                  <button className="btn ghost text-faint opacity-0 group-hover:opacity-100" style={{ height: 18, padding: '0 3px' }} onClick={() => edit(i, null)} title="Remove">
                    <IconX />
                  </button>
                )}
              </span>
            </div>
            {why && (
              <div className="pb-1 pl-2 text-[10.5px] leading-tight text-muted" title="what would make this pair resolved">
                needs Δμ ≥ {why.needDmu === null ? '—' : fmt(why.needDmu)} (has {fmt(why.dmu)})
                {why.sdScale !== null && <> · or SD ×{fmt(why.sdScale, 2)}</>}
                {why.moveTo !== null && (
                  <>
                    {' '}
                    · or {fmt(r!.c1, 3)} → {fmt(why.moveTo, 3)}
                  </>
                )}
              </div>
            )}
            </div>
          )
        })}
        {editable && (
          <input
            type="text"
            inputMode="decimal"
            className="bare mt-1 w-full"
            placeholder="add level…"
            value={add}
            onChange={(e) => setAdd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doAdd()}
            onBlur={() => add && doAdd()}
          />
        )}
      </div>

      <div className="mt-2 flex flex-col gap-1 border-t border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <button className="btn" onClick={runLadder} title={`Next separable concentration from 0: ${metricName} ≥ ${s.kTarget}`}>
            Ladder
          </button>
          {lad && (
            <button className="link" onClick={() => setLadder(null)}>
              Show table levels
            </button>
          )}
        </div>
        {!measure && <span className="text-[11px] text-faint">click the chart to place ruler points</span>}
      </div>
      </>
      )}
    </aside>
  )
}
