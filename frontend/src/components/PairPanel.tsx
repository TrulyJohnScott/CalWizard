/**
 * Middle column, under the curve (core design): the selected point against its lower neighbour. Two gaussians, a
 * threshold you set, the ROC with that threshold marked, and what the calls mean per 1000 samples (spec §16).
 */
import { useEffect, useMemo, useState } from 'react'
import { fmt, pct2, withUnits } from '../format'
import { ratesAt, separate } from '../math/separate'
import type { Derived } from '../state/derived'
import { evalCurve } from '../state/points'
import { rulerPoints, useStore } from '../state/store'
import { Scrub } from './kit'
import { PairPlot } from './SeparateWorkspace'

/** The selected point and the point below it (0 is always there), or null. */
export function selectedPair(_d: Derived, measure: ReturnType<typeof useStore.getState>['measure']): { lo: number; hi: number } | null {
  if (!measure || measure.sel === null || measure.sel === undefined) return null
  const hi = measure.pts[measure.sel]
  const below = rulerPoints(measure, null).filter((c) => c < hi)
  if (hi === undefined || !(hi > 0) || !below.length) return null
  return { lo: below[below.length - 1], hi }
}

function Roc({ r, t }: { r: { c1: number; c2: number; mu1: number; mu2: number; sd1: number; sd2: number }; t: number }) {
  const lo = Math.min(r.mu1 - 5 * r.sd1, r.mu2 - 5 * r.sd2)
  const hi = Math.max(r.mu1 + 5 * r.sd1, r.mu2 + 5 * r.sd2)
  const S = 150
  const pts: string[] = []
  for (let i = 0; i <= 120; i++) {
    const x = ratesAt(lo + ((hi - lo) * i) / 120, r.c1, r.mu1, r.sd1, r.c2, r.mu2, r.sd2)
    pts.push(`${i ? 'L' : 'M'}${(S * (1 - x.specificity)).toFixed(1)} ${(S * (1 - x.sensitivity)).toFixed(1)}`)
  }
  const now = ratesAt(t, r.c1, r.mu1, r.sd1, r.c2, r.mu2, r.sd2)
  return (
    <svg viewBox={`-8 -8 ${S + 16} ${S + 28}`} width={S + 16} role="img" aria-label="ROC curve with the current threshold marked">
      <rect x={0} y={0} width={S} height={S} style={{ fill: 'none', stroke: 'var(--line)' }} />
      <line x1={0} y1={S} x2={S} y2={0} style={{ stroke: 'var(--line)', strokeDasharray: '3 4' }} />
      <path d={pts.join(' ')} style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 2 }} />
      <circle cx={S * (1 - now.specificity)} cy={S * (1 - now.sensitivity)} r={4.5} style={{ fill: 'var(--fg)' }} />
      <text x={S / 2} y={S + 16} textAnchor="middle" style={{ fill: 'var(--muted)', fontSize: 10.5 }}>
        false positives →
      </text>
    </svg>
  )
}

export function PairPanel({ d, pair }: { d: Derived; pair: { lo: number; hi: number } }) {
  const { series: s, model: m } = d
  const [t, setT] = useState<number | null>(null)
  useEffect(() => setT(null), [pair.lo, pair.hi, m])
  const r = useMemo(() => {
    try {
      return separate(evalCurve(s, m), pair.lo, pair.hi, s.metric, s.kTarget, { n: Math.max(2, s.sim.n || 3), runs: 300, seed: 1, threshold: t })
    } catch {
      return null
    }
  }, [s, m, pair.lo, pair.hi, t])
  if (!r) return <div className="label p-4">These two points cannot be compared.</div>
  const th = t ?? r.threshold
  const rates = r.at ?? { sensitivity: r.sensitivity, specificity: r.specificity }
  const step = Math.max(Math.abs(r.mu2 - r.mu1) / 200, 1e-9)
  const u = s.units
  return (
    <div className="flex h-full flex-wrap items-start gap-x-6 gap-y-2 overflow-y-auto px-4 py-3">
      <div className="min-w-[280px] flex-[3]">
        <PairPlot r={{ ...r, threshold: th }} units={u} signalLabel={s.signalLabel || 'Signal'} height={200} />
      </div>
      <div className="flex flex-col items-start gap-2 text-[12.5px]">
        <Roc r={r} t={th} />
      </div>
      <div className="flex min-w-[200px] flex-1 flex-col gap-2 text-[12.5px]">
        <div className="text-muted">
          {withUnits(pair.lo, u)} against {withUnits(pair.hi, u)}
        </div>
        <Scrub label="threshold" value={+th.toPrecision(5)} step={step} width={70} onChange={(v) => setT(v)} title="The signal that splits the calls: drag the label or type. Starts where the two spreads cross." />
        {t !== null && (
          <button className="link self-start text-[11.5px]" onClick={() => setT(null)}>
            back to where they cross
          </button>
        )}
        <div>
          sensitivity <b>{pct2(rates.sensitivity)}</b> · specificity <b>{pct2(rates.specificity)}</b>
        </div>
        <div className="text-muted">
          per 1000 of each: {fmt(Math.round(1000 * (1 - rates.sensitivity)))} missed, {fmt(Math.round(1000 * (1 - rates.specificity)))} false alarms
        </div>
        <div className="text-muted">AUC {r.auc > 0.99995 && r.auc < 1 ? '> 0.9999' : fmt(r.auc, 4)}</div>
      </div>
    </div>
  )
}
