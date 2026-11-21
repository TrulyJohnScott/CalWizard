/**
 * One sentence under the chart (core design): what the screen means right now and what to do, changing with what is
 * selected. No numbers without words.
 */
import { fmt, withUnits } from '../format'
import { pairRow } from '../math/analysis'
import { closenessQ } from '../math/closeness'
import type { Derived } from '../state/derived'
import type { RepeatResult } from '../state/repeat'
import { rulerPoints, useStore } from '../state/store'
import { selectedPair } from './PairPanel'

export function Sentence({ d, repeat }: { d: Derived; repeat: RepeatResult | null }) {
  const measure = useStore((s) => s.measure)
  const { series: s, model: m } = d
  const u = s.units
  const parts: string[] = []
  const pair = selectedPair(d, measure)
  const pts = rulerPoints(measure, null)
  if (pair) {
    const row = pairRow(m, pair.lo, pair.hi, s.metric, s.kTarget)
    const q = closenessQ(row, s.metric, s.kTarget)
    const a = fmt(pair.lo)
    const b = withUnits(pair.hi, u)
    if (q >= 1) parts.push(`${a} and ${b} are apart; the noise could grow ${fmt(q, 2)}× before that stops.`)
    else if (q > 0) parts.push(`${a} and ${b} are too close: they need ${fmt(q, 2)}× of today’s noise, or ${Math.ceil(1 / (q * q))} strips averaged per sample.`)
    else parts.push(`${a} and ${b} give the same signal: no amount of averaging separates them.`)
  } else if (pts.length > 1) {
    const bad = pts.slice(1).map((c, i) => ({ a: pts[i], b: c, q: closenessQ(pairRow(m, pts[i], c, s.metric, s.kTarget), s.metric, s.kTarget) })).filter((x) => x.q < 1)
    const n = pts.length - 1
    if (!bad.length) parts.push(`All ${n} step${n === 1 ? '' : 's'} from 0 are apart. Click a point to see it against the one below.`)
    else parts.push(`${n - bad.length} of ${n} steps are apart; ${fmt(bad[0].a)} → ${withUnits(bad[0].b, u)} is too close. Click a point to see why.`)
  } else {
    const lod = d.limits?.lod?.c ?? null
    const top = d.resolvable.length ? d.resolvable[d.resolvable.length - 1] : null
    parts.push(
      `${d.resolvable.length} concentrations can be told apart from 0${top !== null ? ` up to ${withUnits(top, u)}` : ''}${lod !== null ? `; it detects from ${withUnits(lod, u)}` : ''}${d.limits?.hook ? `; above ${withUnits(d.limits.hook.c, u)} the signal turns back (hook)` : ''}. Click the curve to place your own points.`,
    )
  }
  if (repeat?.back && repeat.at !== null)
    parts.push(`Across ${repeat.runs.length} repeats a sample at ${withUnits(repeat.at, u)} would read back between ${fmt(repeat.back[0])} and ${fmt(repeat.back[1])}.`)
  return <p className="m-0 shrink-0 border-t border-line px-4 py-2 text-[13px] leading-relaxed">{parts.join(' ')}</p>
}
