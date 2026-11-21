/**
 * Separate workspace (spec §16, §21): two concentrations are the centrepiece. One question ("can the assay tell
 * A from B?"), one picture (their two signal distributions), then the numbers and what would change the answer.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { areaPath, Chart, gaussPdf, Label, linePath, linspace, type Ctx } from '../charts/svg'
import { concLabel, fmt, pct2, withUnits } from '../format'
import { METRIC_LABEL } from '../math/metrics'
import type { Model } from '../math/model'
import { kText } from '../math/rule'
import { separate, type Separation } from '../math/separate'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { Page, Scrub, Section, Stat, Verdict } from './kit'

const A = 'var(--accent)'
const B = 'var(--teal)'

/** The pair shown: the stored one, else the first two positive levels (or blank and first). */
export function sepPair(d: Derived, sep: { a: number; b: number } | null): { a: number; b: number } {
  if (sep && sep.a !== sep.b && sep.a >= 0 && sep.b >= 0) return sep
  const pos = d.model.levels.filter((c) => c > 0)
  if (pos.length >= 2) return { a: pos[0], b: pos[1] }
  return { a: pos[0] ?? d.model.cMax / 4, b: pos[0] !== undefined ? pos[0] * 2 : d.model.cMax / 2 }
}

/** The curve with two handles you drag along it. */
function CurvePicker({ m, a, b, xLabel, yLabel, onChange }: { m: Model; a: number; b: number; xLabel: string; yLabel: string; onChange: (p: { a: number; b: number }) => void }) {
  const fit = (hi: number) => (hi <= m.cMax / 6 ? Math.min(m.cMax, hi * 3) : m.cMax)
  const [x1, setX1] = useState(() => fit(Math.max(a, b)))
  // rescale when the pair leaves the view or shrinks far inside it (typed values, another workspace, Undo)
  useEffect(() => {
    const top = Math.max(a, b)
    if (!drag.current && (top > x1 || top < x1 / 6)) setX1(fit(top))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, m.cMax])
  const cs = useMemo(() => linspace(0, x1, 140), [x1])
  const mu = cs.map((c) => m.mean(c))
  const sd = cs.map((c) => m.sd(c))
  const lo = Math.min(...mu.map((v, i) => v - 2 * sd[i]).filter(Number.isFinite))
  const hi = Math.max(...mu.map((v, i) => v + 2 * sd[i]).filter(Number.isFinite))
  const pad = 0.06 * (hi - lo || 1)
  const drag = useRef<'a' | 'b' | null>(null)
  const ctx = useRef<Ctx | null>(null)
  const at = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const c = ctx.current!.invX(e.clientX - r.left)
    return +Math.min(m.cMax, Math.max(0, c)).toPrecision(3)
  }
  const move = (which: 'a' | 'b', c: number) => {
    if (which === 'a' && c !== b) onChange({ a: c, b })
    if (which === 'b' && c !== a) onChange({ a, b: c })
  }
  return (
    <Chart
      height={190}
      x={[0, x1]}
      y={[lo - pad, hi + pad]}
      xLabel={xLabel}
      yLabel={yLabel}
      svgProps={{
        style: { display: 'block', overflow: 'visible', cursor: 'ew-resize', touchAction: 'none' },
        onPointerDown: (e) => {
          const c = at(e)
          const X = ctx.current!.X
          drag.current = Math.abs(X(c) - X(a)) <= Math.abs(X(c) - X(b)) ? 'a' : 'b'
          e.currentTarget.setPointerCapture(e.pointerId)
          move(drag.current, c)
        },
        onPointerMove: (e) => drag.current && move(drag.current, at(e)),
        onPointerUp: () => {
          drag.current = null
          setX1(fit(Math.max(a, b)))
        },
      }}
    >
      {(c) => {
        ctx.current = c
        const P = (i: number, k: number): [number, number] => [c.X(cs[i]), c.Y(mu[i] + k * sd[i])]
        const handle = (v: number, col: string, name: string) => {
          const x = c.X(Math.min(v, x1))
          const y = c.Y(m.mean(v))
          return (
            <g>
              <line x1={x} x2={x} y1={y} y2={c.b} style={{ stroke: col, strokeDasharray: '2 3', opacity: 0.8 }} />
              <circle cx={x} cy={y} r={7} style={{ fill: 'var(--panel)', stroke: col, strokeWidth: 2.2 }} />
              <Label x={x} y={y - 12} color={col} weight={600}>
                {name} · {fmt(v)}
              </Label>
            </g>
          )
        }
        return (
          <>
            <path d={areaPath(cs.map((_, i) => P(i, 2)), cs.map((_, i) => P(i, -2)))} style={{ fill: 'var(--accent)', opacity: 0.08 }} />
            <path d={areaPath(cs.map((_, i) => P(i, 1)), cs.map((_, i) => P(i, -1)))} style={{ fill: 'var(--accent)', opacity: 0.1 }} />
            <path d={linePath(cs.map((_, i) => P(i, 0)))} style={{ fill: 'none', stroke: 'var(--fg)', strokeWidth: 1.5, opacity: 0.75 }} />
            {handle(a, A, 'A')}
            {handle(b, B, 'B')}
          </>
        )
      }}
    </Chart>
  )
}

/** The two signal distributions, their overlap and the cut-off between them. */
export function PairPlot({ r, units, signalLabel, height = 250, width }: { r: Separation; units: string; signalLabel: string; height?: number; width?: number }) {
  const sMax = Math.max(r.sd1, r.sd2)
  const lo = Math.min(r.mu1 - 4 * r.sd1, r.mu2 - 4 * r.sd2)
  const hi = Math.max(r.mu1 + 4 * r.sd1, r.mu2 + 4 * r.sd2)
  if (!(sMax > 0) || !Number.isFinite(lo) || !Number.isFinite(hi)) return <div className="label py-8 text-center">No spread to draw: the curve has no SD here.</div>
  const xs = linspace(lo, hi, 260)
  const p1 = xs.map((x) => gaussPdf(x, r.mu1, r.sd1))
  const p2 = xs.map((x) => gaussPdf(x, r.mu2, r.sd2))
  const top = Math.max(...p1, ...p2) * 1.22
  return (
    <Chart height={height} width={width} x={[lo, hi]} y={[0, top]} xLabel={signalLabel} bareY>
      {(c) => {
        const pts = (p: number[]): [number, number][] => xs.map((x, i) => [c.X(x), c.Y(p[i])])
        const base: [number, number][] = xs.map((x) => [c.X(x), c.Y(0)])
        const ovl = xs.map((_, i) => Math.min(p1[i], p2[i]))
        const peak = (mu: number, sd: number, col: string, text: string) => (
          <Label x={c.X(mu)} y={c.Y(gaussPdf(mu, mu, sd)) - 8} color={col} weight={600} size={12}>
            {text}
          </Label>
        )
        const tx = c.X(r.threshold)
        return (
          <>
            <path d={areaPath(pts(p1), base)} style={{ fill: A, opacity: 0.13 }} />
            <path d={areaPath(pts(p2), base)} style={{ fill: B, opacity: 0.13 }} />
            <path d={areaPath(pts(ovl), base)} style={{ fill: 'var(--warm)', opacity: r.ovl > 0.0005 ? 0.55 : 0 }} />
            <path d={linePath(pts(p1))} style={{ fill: 'none', stroke: A, strokeWidth: 1.8 }} />
            <path d={linePath(pts(p2))} style={{ fill: 'none', stroke: B, strokeWidth: 1.8 }} />
            <line x1={tx} x2={tx} y1={c.t + 14} y2={c.b} style={{ stroke: 'var(--fg)', strokeDasharray: '4 3', opacity: 0.7 }} />
            <Label x={tx} y={c.t + 9} size={10.5} color="var(--muted)">
              cut-off {fmt(r.threshold, 4)}
            </Label>
            {peak(r.mu1, r.sd1, A, withUnits(r.c1, units))}
            {peak(r.mu2, r.sd2, B, withUnits(r.c2, units))}
          </>
        )
      }}
    </Chart>
  )
}

/** The verdict in one sentence, shared with the report. */
export function separationSentence(r: Separation, units: string): { head: string; sub: string } {
  const a = withUnits(r.c1, units)
  const b = withUnits(r.c2, units)
  const right = pct2(1 - r.err)
  const rule = `${METRIC_LABEL[r.metric]} ${fmt(r[r.metric])} against a target of ${kText(r.k)}`
  if (r.pass) return { head: `${a} and ${b} are resolved.`, sub: `A single reading is assigned to the right one ${right} of the time (${rule}).` }
  return { head: `${a} and ${b} are not resolved yet.`, sub: `A single reading is assigned to the right one ${right} of the time (${rule}).` }
}

export function SeparateWorkspace({ d }: { d: Derived }) {
  const ui = useStore((s) => s.ui)
  const setUi = useStore((s) => s.setUi)
  const { series: s, model: m } = d
  const { a, b } = sepPair(d, ui.sep)
  const n = ui.sepN
  // under a what-if the shipped cut-off stays where the measured curve put it: report the rates there too (spec §16)
  const fixedT = useMemo(() => {
    if (!d.baseline) return null
    try {
      return separate(d.baseline.model, a, b, s.metric, s.kTarget, { n: 2, runs: 1, seed: 1 }).threshold
    } catch {
      return null
    }
  }, [d.baseline, a, b, s.metric, s.kTarget])
  const r = useMemo(() => {
    try {
      return separate(m, a, b, s.metric, s.kTarget, { n, runs: 600, seed: 1, threshold: fixedT })
    } catch {
      return null
    }
  }, [m, a, b, s.metric, s.kTarget, n, fixedT])
  const set = (p: { a: number; b: number }) => setUi({ sep: p })
  const u = s.units
  const step = Math.max(m.cMax / 400, 1e-6)
  const pairs = m.levels.slice(1).map((c, i) => ({ a: m.levels[i], b: c }))
  if (!r)
    return (
      <Page>
        <Verdict>Pick two different concentrations</Verdict>
      </Page>
    )
  const say = separationSentence(r, u)
  const why = r.whyNot
  const rb = (i: 0 | 1) => {
    const x = r.readback[i]
    if (x.lo === null || x.hi === null) return '–'
    if (x.loOpen && x.hiOpen) return 'anywhere in the range'
    return x.loOpen ? `< ${fmt(x.hi)}` : x.hiOpen ? `≥ ${fmt(x.lo)}` : `${fmt(x.lo)} – ${fmt(x.hi)}`
  }
  return (
    <Page>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: A }} />
          <Scrub label="A" value={a} step={step} min={0} width={74} suffix={u} onChange={(v) => v !== b && set({ a: v, b })} title="First concentration: type, use the arrow keys, or drag the label" />
        </span>
        <span className="text-faint">vs</span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: B }} />
          <Scrub label="B" value={b} step={step} min={0} width={74} suffix={u} onChange={(v) => v !== a && set({ a, b: v })} title="Second concentration" />
        </span>
        {pairs.length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            <span className="label mr-1">your levels</span>
            {pairs.map((p) => (
              <button key={`${p.a}-${p.b}`} className="btn" data-on={p.a === a && p.b === b} onClick={() => set(p)} title="Compare this neighbouring pair">
                {fmt(p.a)} · {fmt(p.b)}
              </button>
            ))}
          </span>
        )}
      </div>

      <Verdict ok={r.pass} sub={say.sub}>
        {say.head}
      </Verdict>

      <div className="grid gap-x-8 gap-y-4" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 4fr)' }}>
        <div>
          <div className="label mb-1">What a reader sees: the spread of readings at each concentration</div>
          <PairPlot r={r} units={u} signalLabel={s.signalLabel || 'Signal'} />
        </div>
        <div>
          <div className="label mb-1">Where they sit on the curve · drag A and B</div>
          <CurvePicker m={m} a={a} b={b} xLabel={concLabel(s)} yLabel={s.signalLabel || 'Signal'} onChange={set} />
        </div>
      </div>

      <Section title="How well separated">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          <Stat label="Misread, single reading" value={pct2(r.err)} tone={r.pass ? 'good' : 'bad'} title="Chance one reading lands on the wrong side of the cut-off" />
          <Stat label={`${METRIC_LABEL[r.metric]} (target ${kText(r.k)})`} value={fmt(r[r.metric])} tone={r.pass ? 'good' : 'bad'} sub={`Δμ/Σσ ${fmt(r.dsum)} · SSMD ${fmt(r.ssmd)} · Z′ ${fmt(r.zprime)}`} />
          <Stat label="Overlap of the two spreads" value={pct2(r.ovl)} sub={`AUC ${r.auc > 0.99995 && r.auc < 1 ? '> 0.9999' : fmt(r.auc, 4)} · d′ ${fmt(r.dprime)}`} title="Shared area of the two distributions; AUC = chance a B reading exceeds an A reading" />
          <Stat label="Resolvable steps between" value={r.stepsBetween} sub={r.fold !== null ? `${fmt(r.fold)}-fold apart` : 'from the blank'} />
          <Stat
            label={`Best cut-off (${s.signalLabel || 'signal'})`}
            value={fmt(r.threshold, 4)}
            sub={`sensitivity ${pct2(r.sensitivity)} (${r.c2 > r.c1 ? 'B' : 'A'}) · specificity ${pct2(r.specificity)} (${r.c2 > r.c1 ? 'A' : 'B'})`}
            title="Where the two distributions cross. Sensitivity: the higher concentration called positive; specificity: the lower one called negative."
          />
          {r.at && (
            <Stat
              label="At today's cut-off"
              value={fmt(r.at.threshold, 4)}
              tone={Math.min(r.at.sensitivity, r.at.specificity) < Math.min(r.sensitivity, r.specificity) - 0.005 ? 'bad' : undefined}
              sub={`sensitivity ${pct2(r.at.sensitivity)} · specificity ${pct2(r.at.specificity)}`}
              title="The what-if moves the curve but not the cut-off you ship: the threshold set on the measured curve, applied to the changed one"
            />
          )}
          <Stat label={`A · ${withUnits(r.c1, u)}`} value={`${fmt(r.mu1, 4)} ± ${fmt(r.sd1)}`} sub={`CV ${pct2(r.cv1)} · reads back ${rb(0)}`} />
          <Stat label={`B · ${withUnits(r.c2, u)}`} value={`${fmt(r.mu2, 4)} ± ${fmt(r.sd2)}`} sub={`CV ${pct2(r.cv2)} · reads back ${rb(1)}`} />
          <Stat label="Signal difference" value={fmt(Math.abs(r.dmu), 4)} sub={why.needDmu !== null ? `rule needs ${fmt(why.needDmu)}` : undefined} />
        </div>
      </Section>

      <Section title={r.pass ? 'How much room there is' : 'What would resolve them'}>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
          {why.sdScale !== null && (
            <li>
              <b>Noise:</b>{' '}
              {r.pass ? `the spread could grow ${fmt(why.sdScale, 3)}× before they stop being resolved.` : `tighten the spread to ${fmt(why.sdScale, 2)}× of today (CVs near ${pct2((r.cv2 ?? 0) * why.sdScale)}).`}
            </li>
          )}
          {!r.pass && r.nNeeded !== null && (
            <li>
              <b>Replicates:</b> average {r.nNeeded} readings per sample instead of one.
            </li>
          )}
          {!r.pass && why.needDmu !== null && (
            <li>
              <b>Signal:</b> a difference of {fmt(why.needDmu)} is needed at today’s noise; it is {fmt(why.dmu)}.
            </li>
          )}
          {why.moveTo !== null && (
            <li>
              <b>Spacing:</b> the nearest concentration resolved from {withUnits(Math.min(r.c1, r.c2), u)} is {withUnits(why.moveTo, u)}.{' '}
              {!r.pass && (
                <button className="link" onClick={() => set(r.c1 < r.c2 ? { a: r.c1, b: +why.moveTo!.toPrecision(3) } : { a: +why.moveTo!.toPrecision(3), b: r.c2 })}>
                  Move there
                </button>
              )}
            </li>
          )}
        </ul>
      </Section>

      <Section
        title="In an experiment"
        right={<Scrub label="strips per concentration" value={n} step={0.05} min={2} max={200} width={48} digits={3} onChange={(v) => setUi({ sepN: Math.max(2, Math.round(v)) })} />}
      >
        <p className="m-0 max-w-[75ch] text-[13px] leading-relaxed">
          Run {n} strips at each concentration and a t-test finds a significant difference (p &lt; {r.power.alpha}) in{' '}
          <b style={{ color: r.power.pSig >= 0.8 ? 'var(--good)' : 'var(--bad)' }}>{pct2(r.power.pSig)}</b> of experiments. The measured {METRIC_LABEL[r.metric]} reaches its target in{' '}
          {pct2(r.power.pPass)} of them.
          {r.power.pSig < 0.8 && ' Under 80% is usually considered underpowered: add strips or widen the gap.'}
        </p>
      </Section>
    </Page>
  )
}
