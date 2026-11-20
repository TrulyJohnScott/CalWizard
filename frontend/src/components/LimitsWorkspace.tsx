/**
 * Limits workspace (spec §15, §21): LoB, LoD and LoQ in the CLSI EP17 sense. Three numbers first, the two pictures
 * that explain them, then the estimate from the user's own replicates and the experiment that would confirm it.
 */
import { useMemo, useState } from 'react'
import { areaPath, Chart, gaussPdf, Label, linePath, linspace } from '../charts/svg'
import { concLabel, fmt, pct2, withUnits } from '../format'
import { concCv, plan as runPlan, type Limits, type Plan } from '../math/limits'
import type { Model } from '../math/model'
import type { Q } from '../math/experiment'
import type { LimitSettings, Series } from '../math/types'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { Page, Scrub, Section, Stat, Verdict } from './kit'
import { Seg } from './ui'

/** Blank and a sample at the LoD, as the reader sees them: the LoB is the line between "nothing" and "something". */
export function DetectPlot({ m, lim, signalLabel, units, height = 230, width }: { m: Pick<Model, 'mean' | 'sd'>; lim: Limits; signalLabel: string; units: string; height?: number; width?: number }) {
  const rt = Math.sqrt(lim.reads)
  const b = { mu: lim.blank.mean, sd: lim.blank.sd }
  const lod = lim.lod
  const s = lod ? { mu: m.mean(lod.c), sd: m.sd(lod.c) / rt } : null
  if (!(b.sd > 0)) return <div className="label py-8 text-center">The blank has no spread, so there is nothing to draw.</div>
  const all = s ? [b, s] : [b]
  const lo = Math.min(...all.map((g) => g.mu - 4 * g.sd), lim.lob.signal)
  const hi = Math.max(...all.map((g) => g.mu + 4 * g.sd), lim.lob.signal)
  const xs = linspace(lo, hi, 260)
  const pb = xs.map((x) => gaussPdf(x, b.mu, b.sd))
  const ps = s ? xs.map((x) => gaussPdf(x, s.mu, s.sd)) : []
  const top = Math.max(...pb, ...ps) * 1.25
  const d = lim.direction
  const beyond = (x: number) => d * (x - lim.lob.signal) > 0
  return (
    <Chart height={height} width={width} x={[lo, hi]} y={[0, top]} xLabel={signalLabel} bareY>
      {(c) => {
        const pts = (p: number[]): [number, number][] => xs.map((x, i) => [c.X(x), c.Y(p[i])])
        const base: [number, number][] = xs.map((x) => [c.X(x), c.Y(0)])
        const tail = (p: number[], keep: (x: number) => boolean) => {
          const idx = xs.map((x, i) => (keep(x) ? i : -1)).filter((i) => i >= 0)
          return areaPath(idx.map((i) => [c.X(xs[i]), c.Y(p[i])]), idx.map((i) => [c.X(xs[i]), c.Y(0)]))
        }
        const lx = c.X(lim.lob.signal)
        return (
          <>
            <path d={areaPath(pts(pb), base)} style={{ fill: 'var(--muted)', opacity: 0.12 }} />
            <path d={tail(pb, beyond)} style={{ fill: 'var(--warm)', opacity: 0.6 }} />
            <path d={linePath(pts(pb))} style={{ fill: 'none', stroke: 'var(--muted)', strokeWidth: 1.7 }} />
            {s && (
              <>
                <path d={areaPath(pts(ps), base)} style={{ fill: 'var(--accent)', opacity: 0.13 }} />
                <path d={tail(ps, (x) => !beyond(x))} style={{ fill: 'var(--bad)', opacity: 0.45 }} />
                <path d={linePath(pts(ps))} style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 1.8 }} />
                <Label x={c.X(s.mu) - d * 6} y={c.Y(gaussPdf(s.mu, s.mu, s.sd)) - 8} anchor={d > 0 ? 'start' : 'end'} color="var(--accent)" weight={600} size={12}>
                  sample at the LoD · {withUnits(lod!.c, units)}
                </Label>
              </>
            )}
            <Label x={c.X(b.mu) + d * 6} y={c.Y(gaussPdf(b.mu, b.mu, b.sd)) - 8} anchor={d > 0 ? 'end' : 'start'} color="var(--muted)" weight={600} size={12}>
              blank
            </Label>
            <line x1={lx} x2={lx} y1={c.t + 14} y2={c.b} style={{ stroke: 'var(--fg)', strokeDasharray: '4 3', opacity: 0.75 }} />
            <Label x={lx} y={c.t + 9} size={10.5} color="var(--muted)">
              LoB · signal {fmt(lim.lob.signal, 4)}
            </Label>
          </>
        )
      }}
    </Chart>
  )
}

/** Precision profile: CV of the reported concentration against concentration, with the quantifiable range shaded. */
export function ProfilePlot({ m, lim, xLabel, x1, height = 230, width }: { m: Pick<Model, 'mean' | 'sd' | 'cMax'>; lim: Limits; xLabel: string; x1: number; height?: number; width?: number }) {
  // drawn from the curve over the visible window, so the steep climb near zero stays smooth when zoomed in
  const cs = linspace(0, x1, 240).slice(1)
  const cvs = cs.map((c) => concCv(m, c, lim.reads))
  const cap = Math.max(lim.cv * 3, 0.6)
  const from = lim.lod ? lim.lod.c * 0.6 : 0
  const yTop = Math.min(cap, Math.max(lim.cv * 1.6, ...cvs.filter((v, i) => cs[i] >= from && Number.isFinite(v)).map((v) => Math.min(v, cap)))) * 100
  return (
    <Chart height={height} width={width} x={[0, x1]} y={[0, yTop]} xLabel={xLabel} yLabel="CV of the result (%)" yFormat={(v) => fmt(v, 3)}>
      {(c) => {
        const pts: [number, number][] = cs.map((v, i) => [c.X(v), c.Y(Math.min(cvs[i] * 100, yTop * 1.5))])
        const ty = c.Y(lim.cv * 100)
        const mark = (v: number | undefined, text: string, col: string) =>
          v !== undefined && v <= x1 ? (
            <g>
              <line x1={c.X(v)} x2={c.X(v)} y1={c.t + 12} y2={c.b} style={{ stroke: col, strokeDasharray: '3 3' }} />
              <Label x={c.X(v)} y={c.t + 8} color={col} size={10.5} weight={600}>
                {text}
              </Label>
            </g>
          ) : null
        return (
          <>
            {lim.loq && lim.uloq && (
              <rect x={c.X(Math.min(lim.loq.c, x1))} y={c.t} width={Math.max(0, c.X(Math.min(lim.uloq.c, x1)) - c.X(Math.min(lim.loq.c, x1)))} height={c.b - c.t} style={{ fill: 'var(--good)', opacity: 0.07 }} />
            )}
            <line x1={c.l} x2={c.r} y1={ty} y2={ty} style={{ stroke: 'var(--good)', strokeDasharray: '5 4', opacity: 0.9 }} />
            <Label x={c.r - 2} y={ty - 5} anchor="end" color="var(--good)" size={10.5}>
              {`${fmt(lim.cv * 100, 3)}% allowed`}
            </Label>
            <clipPath id="profclip">
              <rect x={c.l} y={c.t} width={c.r - c.l} height={c.b - c.t} />
            </clipPath>
            <path d={linePath(pts)} clipPath="url(#profclip)" style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 1.9 }} />
            {mark(lim.lod?.c, 'LoD', 'var(--muted)')}
            {mark(lim.loq?.c, 'LoQ', 'var(--good)')}
          </>
        )
      }}
    </Chart>
  )
}

const qRange = (q: Q, d = 3) => (q.lo === null || q.hi === null ? '–' : `${fmt(q.lo, d)} – ${fmt(q.hi, d)}`)

/** Range bar: the spread of an estimate over many simulated experiments, with the true value ticked. */
function RangeBar({ q, truth }: { q: Q; truth: number | null }) {
  if (q.min === null || q.max === null || q.lo === null || q.hi === null) return null
  const lo = Math.min(q.min, truth ?? q.min)
  const hi = Math.max(q.max, truth ?? q.max)
  const X = (v: number) => `${(100 * (v - lo)) / (hi - lo || 1)}%`
  return (
    <div className="relative h-4 w-full">
      <div className="absolute top-[7px] h-px w-full" style={{ background: 'var(--line)' }} />
      <div className="absolute top-[4px] h-[7px] rounded-full" style={{ left: X(q.lo), width: `calc(${X(q.hi)} - ${X(q.lo)})`, background: 'var(--accent)', opacity: 0.35 }} />
      {q.med !== null && <div className="absolute top-[2px] h-[11px] w-[2px]" style={{ left: X(q.med), background: 'var(--accent)' }} />}
      {truth !== null && <div className="absolute top-0 h-[15px] w-px" style={{ left: X(truth), background: 'var(--fg)' }} title="from the curve" />}
    </div>
  )
}

function Planner({ d }: { d: Derived }) {
  const ui = useStore((s) => s.ui)
  const setUi = useStore((s) => s.setUi)
  const notify = useStore((s) => s.notify)
  const addSimLevel = useStore((s) => s.addSimLevel)
  const { series: s, model: m } = d
  const p = ui.plan
  const set = (x: Partial<typeof p>) => setUi({ plan: { ...p, ...x } })
  const [lowText, setLowText] = useState<string | null>(null)
  const res = useMemo<{ plan: Plan | null; error: string | null }>(() => {
    try {
      return { plan: runPlan(m, { nBlank: p.nBlank, nLow: p.nLow, low: p.low, runs: 400, seed: p.seed, alpha: s.limits.alpha, beta: s.limits.beta, cv: s.limits.cv }), error: null }
    } catch (e) {
      return { plan: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [m, p, s.limits.alpha, s.limits.beta, s.limits.cv])
  const pl = res.plan
  const u = s.units
  const low = pl ? pl.design.rows.filter((r) => r.sample.startsWith('low')).map((r) => r.c) : p.low ?? []
  const rel = pl && pl.lod.lo !== null && pl.lod.hi !== null && pl.truth.lod ? (pl.lod.hi - pl.lod.lo) / 2 / pl.truth.lod : null
  const copy = () => {
    if (!pl) return
    const tsv = ['Sample\tConcentration' + (u ? ` (${u})` : '') + '\tStrips', ...pl.design.rows.map((r) => `${r.sample}\t${fmt(r.c, 4)}\t${r.n}`), `Total\t\t${pl.design.strips}`].join('\n')
    navigator.clipboard?.writeText(tsv).then(() => notify('Plan copied: paste it into a spreadsheet', false))
  }
  return (
    <Section title="Plan the experiment that confirms it" hint="Simulates the EP17 design 400 times from the curve: how close would your estimate land?">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Scrub label="blank strips" value={p.nBlank} step={0.1} min={2} max={500} width={48} onChange={(v) => set({ nBlank: Math.max(2, Math.round(v)) })} />
        <Scrub label="strips per low level" value={p.nLow} step={0.1} min={2} max={500} width={48} onChange={(v) => set({ nLow: Math.max(2, Math.round(v)) })} />
        <label className="inline-flex items-center gap-1.5" title="Low concentrations to run, comma separated. Empty = the LoD and twice the LoD.">
          <span className="label">low levels</span>
          <input
            type="text"
            style={{ width: 130 }}
            value={lowText ?? low.map((c) => fmt(c, 4)).join(', ')}
            onChange={(e) => setLowText(e.target.value)}
            onBlur={() => {
              if (lowText === null) return
              const vals = lowText.split(/[\s,;]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v) && v > 0)
              set({ low: vals.length ? vals : null })
              setLowText(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {u && <span className="label">{u}</span>}
        </label>
        <button className="btn" onClick={() => set({ seed: p.seed + 1 })} title="Draw a different set of simulated experiments">
          Re-roll
        </button>
      </div>
      {res.error && <div className="text-[12px] text-bad">{res.error}</div>}
      {pl && (
        <div className="grid gap-x-10 gap-y-4" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)' }}>
          <div>
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pb-1 font-normal">Sample</th>
                  <th className="pb-1 text-right font-normal">{concLabel(s)}</th>
                  <th className="pb-1 text-right font-normal">Strips</th>
                </tr>
              </thead>
              <tbody>
                {pl.design.rows.map((r) => (
                  <tr key={r.sample} className="border-t border-line">
                    <td className="py-1">{r.sample}</td>
                    <td className="py-1 text-right">{fmt(r.c, 4)}</td>
                    <td className="py-1 text-right">{r.n}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-semibold">
                  <td className="py-1">Total</td>
                  <td />
                  <td className="py-1 text-right">{pl.design.strips}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-2 flex gap-3">
              <button className="link" onClick={copy}>
                Copy plan
              </button>
              <button
                className="link"
                title="Add the low concentrations to the curve as levels, so they show on every chart"
                onClick={() => {
                  const added = low.filter((c) => addSimLevel(c)).length
                  if (added) notify(`Added ${added} low ${added === 1 ? 'level' : 'levels'} to the curve`)
                }}
              >
                Add low levels to the curve
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-3 text-[13px]">
            <p className="m-0 leading-relaxed">
              With these {pl.design.strips} strips, your LoD estimate would land between <b>{qRange(pl.lod)}</b>
              {u ? ` ${u}` : ''} in 90% of experiments
              {rel !== null && (
                <>
                  {' '}
                  (about <b style={{ color: rel <= 0.2 ? 'var(--good)' : rel <= 0.4 ? 'var(--warm)' : 'var(--bad)' }}>±{pct2(rel)}</b>)
                </>
              )}
              . The curve says {withUnits(pl.truth.lod, u)}.
            </p>
            <div>
              <div className="label mb-0.5">LoD estimate, 90% of experiments · tick = the curve’s value</div>
              <RangeBar q={pl.lod} truth={pl.truth.lod} />
            </div>
            <div>
              <div className="label mb-0.5">LoB signal: {qRange(pl.lobSignal, 4)}</div>
              <RangeBar q={pl.lobSignal} truth={pl.truth.lobSignal} />
            </div>
            {pl.loq && (
              <p className="m-0 leading-relaxed">
                The {pl.loq.n} strips at the LoQ ({withUnits(pl.loq.c, u)}) would show a result CV between{' '}
                <b>
                  {pct2(pl.loq.cv.lo)} and {pct2(pl.loq.cv.hi)}
                </b>
                ; it is truly {pct2(pl.loq.cvTruth)}, so the {fmt(pl.loq.cvTarget * 100, 3)}% claim is confirmed in {pct2(pl.loq.pPass)} of experiments.
                {pl.loq.pPass < 0.8 && ' To confirm it reliably, claim a LoQ a little higher or run more strips there.'}
              </p>
            )}
            <div className="label">
              Detected above the LoB: {pl.detect.map((x) => `${withUnits(x.c, u)} in ${pct2(x.mean)} of strips`).join(' · ')}
              {pl.lodFound < 1 && ` · no LoD could be read off the curve in ${pct2(1 - pl.lodFound)} of experiments`}
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

/** One-line plain-words summary, shared with the report. */
export function limitsSentence(lim: Limits, s: Pick<Series, 'units'>): string {
  if (!lim.lod) return 'Nothing in this range rises clearly above the blank.'
  const lod = withUnits(lim.lod.c, s.units)
  if (!lim.loq) return `Detects down to ${lod}, but never reaches ${fmt(lim.cv * 100, 3)}% CV.`
  return `Detects down to ${lod} and quantifies from ${fmt(lim.loq.c)} to ${withUnits(lim.uloq ? lim.uloq.c : null, s.units)}.`
}

/** The positive concentrations of the table that have at least two readings: candidates for the low-level columns. */
function lowCandidates(s: Series): number[] {
  if (s.mode !== 'replicates') return []
  const out: number[] = []
  s.replicates.concs.forEach((c, j) => {
    if (typeof c === 'number' && c > 0 && (s.replicates.cells[j] ?? []).filter((y) => typeof y === 'number' && Number.isFinite(y)).length >= 2) out.push(c)
  })
  return [...new Set(out)].sort((a, b) => a - b)
}

export function LimitsWorkspace({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const setUi = useStore((s) => s.setUi)
  const { series: s, model: m, limits: lim, limitsData: data } = d
  const [whole, setWhole] = useState(false)
  const set = (p: Partial<LimitSettings>) => patch({ limits: { ...s.limits, ...p } })
  if (!lim)
    return (
      <Page>
        <Verdict>The curve is not valid yet</Verdict>
      </Page>
    )
  const u = s.units
  const zoom = lim.loq ? Math.min(m.cMax, Math.max(lim.loq.c * 4, (lim.lod?.c ?? 0) * 6)) : lim.lod ? Math.min(m.cMax, lim.lod.c * 8) : m.cMax
  const x1 = whole ? m.cMax : zoom
  return (
    <Page>
      <Verdict ok={lim.lod !== null} sub="Limit of blank: the highest signal a blank is expected to give. Limit of detection: the lowest concentration reliably told from a blank. Limit of quantitation: the lowest concentration reported within the allowed CV.">
        {limitsSentence(lim, s)}
      </Verdict>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <Stat label="LoB" value={withUnits(lim.lob.c, u)} sub={`signal ${fmt(lim.lob.signal, 4)}`} title="Limit of blank: blank mean + z(1 − α)·SD of the blank" />
        <Stat label="LoD" value={withUnits(lim.lod?.c, u)} tone="accent" sub={lim.lod ? `signal ${fmt(lim.lod.signal, 4)} · CV there ${pct2(lim.lod.cv)}` : 'not reached in this range'} title="Lowest concentration whose readings exceed the LoB with probability 1 − β" />
        <Stat label="LoQ" value={withUnits(lim.loq?.c, u)} tone="good" sub={lim.loq ? `signal ${fmt(lim.loq.signal, 4)}` : `never within ${fmt(lim.cv * 100, 3)}% CV`} title="Lowest concentration at or above the LoD whose result CV is within the allowed CV" />
        <Stat label="Quantifiable range" value={lim.loq && lim.uloq ? `${fmt(lim.loq.c)} – ${fmt(lim.uloq.c)}` : '–'} sub={lim.loq && lim.uloq && lim.loq.c > 0 ? `${fmt(lim.uloq.c / lim.loq.c, 2)}-fold${u ? ` · ${u}` : ''}` : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3">
        <Scrub label="false positives α" value={+(s.limits.alpha * 100).toPrecision(4)} step={0.05} min={0.01} max={49} width={46} suffix="%" onChange={(v) => set({ alpha: v / 100 })} title="Share of blanks allowed to read above the LoB" />
        <Scrub label="false negatives β" value={+(s.limits.beta * 100).toPrecision(4)} step={0.05} min={0.01} max={49} width={46} suffix="%" onChange={(v) => set({ beta: v / 100 })} title="Share of samples at the LoD allowed to read below the LoB" />
        <Scrub label="CV allowed at LoQ" value={+(s.limits.cv * 100).toPrecision(4)} step={0.1} min={0.5} max={200} width={46} suffix="%" onChange={(v) => set({ cv: v / 100 })} />
        <Scrub label="strips averaged per result" value={s.limits.reads} step={0.03} min={1} max={100} width={40} onChange={(v) => set({ reads: Math.max(1, Math.round(v)) })} title="Report the mean of this many strips: the noise shrinks by its square root" />
      </div>

      <div className="grid gap-x-8 gap-y-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <div>
          <div className="label mb-1">
            Detection: {fmt(s.limits.alpha * 100, 3)}% of blanks read above the LoB (orange), {fmt(s.limits.beta * 100, 3)}% of LoD samples read below it (red)
          </div>
          <DetectPlot m={m} lim={lim} signalLabel={s.signalLabel || 'Signal'} units={u} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label">Precision profile: how tightly a result is known at each concentration</span>
            {zoom < m.cMax && <Seg value={whole ? 'all' : 'low'} options={[['low', 'Low end'], ['all', 'Whole range']]} onChange={(v) => setWhole(v === 'all')} />}
          </div>
          <ProfilePlot m={m} lim={lim} xLabel={concLabel(s)} x1={x1} />
        </div>
      </div>

      {data ? (
        <Section
          title="From your replicates"
          hint="CLSI EP17 classical estimate from the blank column and the low-level columns of the table"
          right={
            <span className="flex flex-wrap items-center gap-1">
              <span className="label mr-1">low-level columns</span>
              {lowCandidates(s).slice(0, 8).map((c) => {
                const used = data.low.some((x) => x.c === c)
                return (
                  <button
                    key={c}
                    className="btn"
                    data-on={used}
                    style={{ height: 22 }}
                    title={used ? 'Used for the pooled low-level SD: click to leave it out' : 'Click to include this column'}
                    onClick={() => {
                      const cur = data.low.map((x) => x.c)
                      const next = used ? cur.filter((x) => x !== c) : [...cur, c].sort((a, b) => a - b)
                      if (next.length) setUi({ lowConcs: next })
                    }}
                  >
                    {fmt(c)}
                  </button>
                )
              })}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <Stat label={`LoB · ${data.blank.n} blanks`} value={fmt(data.lob.signal, 4)} sub={`rank-based ${fmt(data.lob.signalNonparametric, 4)} · as c ${withUnits(data.lob.c, u)}`} title="Blank mean + c_p·SD (parametric), and the rank percentile of the blank readings" />
            <Stat label="LoD" value={withUnits(data.lod.c, u)} tone="accent" sub={`signal ${fmt(data.lod.signal, 4)}`} title="LoB + c_p · pooled SD of the low-level columns, read back on the curve" />
            <Stat label="Low-level columns used" value={data.low.map((x) => fmt(x.c)).join(', ')} sub={`pooled SD ${fmt(data.sdLow)} · ${data.df} degrees of freedom`} />
            <Stat label="Against the curve" value={lim.lod && data.lod.c !== null ? `${fmt(data.lod.c / lim.lod.c, 2)}×` : '–'} sub="data LoD ÷ curve LoD" />
          </div>
        </Section>
      ) : (
        s.mode !== 'replicates' && (
          <p className="m-0 border-t border-line pt-3 text-[12px] text-muted">
            These limits come from the curve. Load replicate readings with at least two blanks and one low level to also get the classical estimate from data.
          </p>
        )
      )}

      <Planner d={d} />
    </Page>
  )
}
