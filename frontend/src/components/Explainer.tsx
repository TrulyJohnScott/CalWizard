/**
 * What the separation rule means (core design): two spreads, the gap between their means as N × the rule's spread,
 * the threshold, and how often one reading lands on the wrong side. Uses the selected pair when there is one, else two
 * equal spreads at exactly the rule's N. Opens from "?" by the rule, and by itself on first use.
 */
import { fmt, pct2, withUnits } from '../format'
import { ruleError } from '../math/rule'
import { ratesAt } from '../math/separate'
import type { Derived } from '../state/derived'
import { evalCurve } from '../state/points'
import { useStore } from '../state/store'
import { RULE_GAP, RULE_NAME } from './TopBar'

const W = 520
const H = 150

export function Explainer({ d, pair }: { d: Derived; pair: { lo: number; hi: number } | null }) {
  const setUi = useStore((s) => s.setUi)
  const s = d.series
  const N = s.kTarget
  const cur = evalCurve(s, d.model)
  const m1 = pair ? cur.mean(pair.lo) : 0
  const s1 = pair ? cur.sd(pair.lo) : 1
  const s2 = pair ? cur.sd(pair.hi) : 1
  const spread = s.metric === 'ssmd' ? Math.hypot(s1, s2) : s1 + s2
  const m2 = pair ? cur.mean(pair.hi) : m1 + N * spread
  const gapN = Math.abs(m2 - m1) / spread
  const lo = Math.min(m1 - 4 * s1, m2 - 4 * s2)
  const hi = Math.max(m1 + 4 * s1, m2 + 4 * s2)
  const t = (m1 * s2 + m2 * s1) / (s1 + s2)
  const r = ratesAt(t, pair?.lo ?? 0, m1, s1, pair?.hi ?? 1, m2, s2)
  const err = (1 - r.sensitivity + (1 - r.specificity)) / 2
  const X = (v: number) => 10 + ((v - lo) / (hi - lo)) * (W - 20)
  const top = Math.max(1 / s1, 1 / s2) / Math.sqrt(2 * Math.PI) * 1.15
  const Y = (p: number) => H - 30 - (p / top) * (H - 45)
  const path = (m: number, sd: number) => {
    let out = ''
    for (let i = 0; i <= 140; i++) {
      const v = lo + ((hi - lo) * i) / 140
      out += `${i ? 'L' : 'M'}${X(v).toFixed(1)} ${Y(Math.exp(-0.5 * ((v - m) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))).toFixed(1)}`
    }
    return out
  }
  const one = err > 0 ? Math.max(1, Math.round(1 / err)) : null
  const pass = gapN >= N - 1e-9
  const u = s.units
  return (
    <div className="flex h-full items-start gap-x-6 overflow-y-auto px-4 py-3 text-[12.5px]">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 'min(48%, 520px)', flex: '0 0 auto' }} role="img" aria-label="Two spreads with the gap between their means">
        <path d={path(m1, s1)} style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 2 }} />
        <path d={path(m2, s2)} style={{ fill: 'none', stroke: 'var(--teal)', strokeWidth: 2 }} />
        <line x1={X(t)} x2={X(t)} y1={10} y2={H - 30} style={{ stroke: 'var(--muted)', strokeDasharray: '4 3' }} />
        <line x1={X(m1)} x2={X(m2)} y1={H - 16} y2={H - 16} style={{ stroke: 'var(--fg)' }} />
        <line x1={X(m1)} x2={X(m1)} y1={H - 21} y2={H - 11} style={{ stroke: 'var(--fg)' }} />
        <line x1={X(m2)} x2={X(m2)} y1={H - 21} y2={H - 11} style={{ stroke: 'var(--fg)' }} />
        <text x={(X(m1) + X(m2)) / 2} y={H - 2} textAnchor="middle" style={{ fill: 'var(--fg)', fontSize: 11 }}>
          gap = {fmt(gapN, 2)} × ({RULE_GAP[s.metric]})
        </text>
      </svg>
      <div className="flex min-w-[240px] flex-1 flex-col gap-2 leading-relaxed">
        <b>
          {RULE_NAME[s.metric]}: neighbours count as apart when their means differ by at least {fmt(N, 2)} × ({RULE_GAP[s.metric]}).
        </b>
        {s.metric === 'ssmd' ? (
          <span>This compares one reading of each with the other: at N = 3 they come out in the right order 99.9% of the time. For a single reading against a threshold it is looser (about {pct2(ruleError('ssmd', N))} misread with equal spreads).</span>
        ) : (
          <span>Each reading must sit {fmt(N, 2)} of its own SDs from the threshold: a single reading is misread about {pct2(ruleError('dsum', N))} of the time with equal spreads.</span>
        )}
        <span>
          {pair ? `${fmt(pair.lo)} and ${withUnits(pair.hi, u)}` : 'Here'}: the gap is {fmt(gapN, 2)} ×, so they are <b style={{ color: pass ? 'var(--good)' : 'var(--bad)' }}>{pass ? 'apart' : 'too close'}</b>; one reading lands on the wrong side {one ? `about 1 time in ${one.toLocaleString()}` : 'essentially never'}.
        </span>
        <button className="link self-start" onClick={() => setUi({ explain: false })}>
          close
        </button>
      </div>
    </div>
  )
}
