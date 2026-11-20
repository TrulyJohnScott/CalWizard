/**
 * Variability workspace, two more sections (spec §23, §24):
 * - Conditions: the same assay measured under several conditions (lots, readers, days), each its own curve, compared
 *   with the one being edited; the spread between them can become a layer.
 * - Error budget: fixed bias plus k·SD of every source, stacked in concentration units against the allowed error.
 */
import { useMemo } from 'react'
import { Chart, linePath, linspace } from '../charts/svg'
import { concLabel, fmt, pct2, withUnits } from '../format'
import { compare } from '../math/conditions'
import { tolerance } from '../math/layers'
import { compileModel } from '../math/model'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { Dot, Scrub, Section } from './kit'
import { layerColor } from './LayersEditor'
import { IconX } from './ui'

const signed = (x: number | null) => (x === null || !Number.isFinite(x) ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${pct2(Math.abs(x))}`)

export function ConditionsSection({ d }: { d: Derived }) {
  const all = useStore((s) => s.series)
  const activeId = useStore((s) => s.activeId)
  const add = useStore((s) => s.addCondition)
  const select = useStore((s) => s.selectCondition)
  const remove = useStore((s) => s.removeCondition)
  const patch = useStore((s) => s.patch)
  const notify = useStore((s) => s.notify)
  // the condition being edited is the reference; the others follow in their stored order
  const items = useMemo(() => [...all].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0)).map((s) => ({ series: s, model: s.id === activeId ? d.model : compileModel(s) })), [all, activeId, d.model])
  const cmp = useMemo(() => {
    try {
      return compare(items)
    } catch {
      return null
    }
  }, [items])
  const many = items.length > 1
  const { series: s, model: m } = d
  const x1 = m.cMax
  const curves = useMemo(() => {
    const cs = linspace(0, x1, 120)
    return { cs, ys: items.map((it) => cs.map((c) => it.model.mean(c))) }
  }, [items, x1])
  const flat = curves.ys.flat().filter(Number.isFinite)
  const range = (i: number) => {
    const v = (cmp?.rows ?? []).map((r) => r.concBias[i]).filter((x): x is number => x !== null)
    return v.length ? `${signed(Math.min(...v))} to ${signed(Math.max(...v))}` : '–'
  }
  const b = cmp?.between
  return (
    <Section
      title="Conditions"
      hint="The same assay under several conditions (lots, readers, days), each with its own curve"
      right={
        <button className="btn" onClick={() => add(`${s.name} ${all.length + 1}`)} title="Start another condition from a copy of this one, then paste or import its own data">
          + Add a condition
        </button>
      }
    >
      {!many ? (
        <p className="m-0 max-w-[75ch] text-[12.5px] leading-relaxed text-muted">
          One curve so far. If you measured another lot, reader or day, add a condition and paste its readings: each keeps its own curve, and this page shows how far they sit apart.
        </p>
      ) : (
        <div className="grid gap-x-10 gap-y-4" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 4fr)' }}>
          <div>
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-right text-muted">
                  <th className="pb-1 text-left font-normal">Condition</th>
                  <th className="pb-1 font-normal">Levels</th>
                  <th className="pb-1 font-normal">LoD</th>
                  <th className="pb-1 font-normal">LoQ</th>
                  <th className="pb-1 font-normal" title="If this condition's strips were read on the curve being edited: how far off the reported concentration would be, across the levels">
                    Reads on this curve
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.series.id} className="group border-t border-line text-right">
                    <td className="py-1 text-left">
                      <button className="link text-[12.5px]" style={{ color: i === 0 ? 'var(--fg)' : undefined, fontWeight: i === 0 ? 600 : 400 }} disabled={i === 0} onClick={() => select(it.series.id)} title={i === 0 ? 'The condition being edited: the reference' : 'Edit this condition (it becomes the reference)'}>
                        <i className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: i === 0 ? 'var(--accent)' : layerColor(i) }} />
                        {it.series.name || 'Untitled'}
                      </button>
                    </td>
                    <td className="py-1">{cmp?.conditions[i].levels ?? '–'}</td>
                    <td className="py-1">{fmt(cmp?.conditions[i].lod)}</td>
                    <td className="py-1">{fmt(cmp?.conditions[i].loq)}</td>
                    <td className="py-1 text-muted">{i === 0 ? 'reference' : range(i)}</td>
                    <td className="w-6 py-1">
                      <button
                        className="btn ghost text-faint opacity-0 group-hover:opacity-100"
                        style={{ height: 18, padding: '0 3px' }}
                        title="Remove this condition"
                        onClick={() => {
                          remove(it.series.id)
                          notify(`Removed “${it.series.name}”`)
                        }}
                      >
                        <IconX />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {b && (
              <p className="m-0 mt-3 text-[12.5px] leading-relaxed">
                Between these {b.units} curves the blank moves by an SD of <b>{fmt(b.offsetSd)}</b> and the response by <b>{pct2(b.gainCv)}</b>.{' '}
                <button
                  className="link"
                  title="Add (or update) a layer named Condition with these sizes, so every claim includes the spread between conditions"
                  onClick={() => {
                    const layer = { name: 'Condition', units: b.units, on: true, offsetSd: +b.offsetSd.toPrecision(3), cv: 0, gainCv: +b.gainCv.toPrecision(3), noiseCv: 0, biasOffset: 0, biasPct: 0 }
                    const cur = s.layers ?? []
                    patch({ layers: cur.some((l) => l.name === 'Condition') ? cur.map((l) => (l.name === 'Condition' ? { ...l, ...layer } : l)) : [...cur, layer] })
                    notify('The spread between conditions is now a layer')
                  }}
                >
                  Use as a layer
                </button>
              </p>
            )}
          </div>
          <Chart height={210} x={[0, x1]} y={[Math.min(...flat), Math.max(...flat)]} xLabel={concLabel(s)} yLabel={s.signalLabel || 'Signal'}>
            {(c) => (
              <>
                {curves.ys.map((ys, i) =>
                  i === 0 ? null : <path key={i} d={linePath(curves.cs.map((v, j) => [c.X(v), c.Y(ys[j])]))} style={{ fill: 'none', stroke: layerColor(i), strokeWidth: 1.5 }} />,
                )}
                <path d={linePath(curves.cs.map((v, j) => [c.X(v), c.Y(curves.ys[0][j])]))} style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 2.2 }} />
              </>
            )}
          </Chart>
        </div>
      )}
    </Section>
  )
}

export function ErrorBudgetSection({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const { series: s, model: m } = d
  const tol = useMemo(() => {
    try {
      return tolerance(s, m)
    } catch {
      return null
    }
  }, [s, m])
  if (!tol) return null
  const set = (p: Partial<typeof s.tolerance>) => patch({ tolerance: { ...s.tolerance, ...p } })
  const rows = tol.rows.filter((r) => r.c > 0 && r.rel !== null)
  // bars longer than three times the limit are clipped, so the levels near the limit stay readable
  const scale = Math.min(tol.tea * 3, Math.max(tol.tea * 1.6, ...rows.map((r) => r.rel as number))) || 1
  const names = tol.rows[0]?.sources.map((x) => x.name) ?? []
  const color = (i: number) => (i === 0 ? 'var(--muted)' : layerColor(i - 1))
  return (
    <Section
      title="Error budget"
      hint="How far a reported concentration can be from the truth: fixed bias plus k times the spread of every source, as a share of the concentration"
      right={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Scrub label="allowed total error" value={+(s.tolerance.tea * 100).toPrecision(4)} step={0.1} min={0.5} max={500} width={46} suffix="%" onChange={(v) => set({ tea: v / 100 })} />
          <Scrub label="coverage k" value={s.tolerance.k} step={0.01} min={0.5} max={6} width={42} digits={3} onChange={(v) => set({ k: v })} title="How many SDs of spread the budget covers: 2 is about 95%" />
        </span>
      }
    >
      <div className="mb-2 text-[12.5px]">
        {tol.total > 0 && (
          <span className="mr-3">
            <Dot ok={tol.met === tol.total} /> <b>{tol.met === tol.total ? 'Within the allowed error at every level.' : `Within the allowed error at ${tol.met} of ${tol.total} levels.`}</b>
          </span>
        )}
        <span className="text-muted">Each bar: fixed bias (solid) then k·SD per source, stacked; the line is the limit.</span>
      </div>
      {rows.map((r) => {
        const worst = r.sources.map((x) => ({ bias: Math.abs(x.biasC ?? 0) / r.c, sd: (tol.k * (x.sdC ?? 0)) / r.c }))
        const w = (v: number) => `${(100 * v) / scale}%`
        // the root-sum-square total is shorter than the linear stack: draw the stack scaled to it, so the bar ends at the total
        const lin = worst.reduce((a, x) => a + x.bias + x.sd, 0) || 1
        const f = (r.rel as number) / lin
        return (
          <div key={r.c} className="mb-1.5 grid items-center gap-3 text-[12px]" style={{ gridTemplateColumns: '70px minmax(0, 1fr) 250px' }}>
            <span className="text-muted">{withUnits(r.c, s.units)}</span>
            <div className="relative h-[14px] rounded-sm" style={{ background: 'var(--hover)' }} title={r.sources.map((x) => `${x.name}: bias ${signed((x.biasC ?? 0) / r.c)}, SD ${pct2((x.sdC ?? 0) / r.c)}`).join('\n')}>
              <div className="flex h-full overflow-hidden rounded-sm">
                {worst.map((x, i) => (x.bias > 0 ? <div key={`b${i}`} style={{ width: w(x.bias * f), background: color(i) }} /> : null))}
                {worst.map((x, i) => (x.sd > 0 ? <div key={`s${i}`} style={{ width: w(x.sd * f), background: color(i), opacity: 0.45 }} /> : null))}
              </div>
              <div className="absolute -top-[3px] h-[20px] w-px" style={{ left: w(tol.tea), background: 'var(--fg)' }} />
            </div>
            <span className="whitespace-nowrap">
              <b style={{ color: r.ok ? 'var(--good)' : 'var(--bad)' }}>±{pct2(r.rel)}</b>
              <span className="text-muted">
                {' '}
                · bias {signed((r.bias as number) / r.c)} · worst ±{pct2(r.worstRel)}
              </span>
            </span>
          </div>
        )
      })}
      <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted">
        {names.map((n, i) => (
          <span key={n}>
            <i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: color(i) }} />
            {n}
          </span>
        ))}
        <span>± = |bias| + k·√(sum of variances) · worst = every source at its limit at once</span>
      </div>
    </Section>
  )
}
