/**
 * The evaluated points (core design): your concentrations, separate from the calibration data. Each point is
 * measured with its own number of strips (default limits.reads); only within-run noise averages over strips.
 */
import { pairRow } from '../math/analysis'
import { closenessQ } from '../math/closeness'
import { sdOfReads } from '../math/limits'
import type { Model } from '../math/model'
import type { Series } from '../math/types'

export type EvalCurve = Pick<Model, 'mean' | 'sd' | 'cMax' | 'levels'>

/** Strips used at concentration c: the point's own count, else the default. */
export function stripsAt(s: Pick<Series, 'points' | 'limits'>, c: number): number {
  const p = (s.points ?? []).find((x) => x.c === c)
  return p?.strips ?? s.limits.reads ?? 1
}

/** The curve as your points see it: the same mean, the SD of one result (the mean of that point's strips). */
export function evalCurve(s: Pick<Series, 'points' | 'limits'>, m: Model): EvalCurve {
  return { mean: m.mean, cMax: m.cMax, levels: m.levels, sd: (c: number) => sdOfReads(m, c, stripsAt(s, c)) }
}

export interface Step {
  a: number
  b: number
  /** closeness: ≥ 1 apart, < 1 too close */
  q: number
  /** gap in units of the rule's spread (N achieved) */
  n: number
}

/** Each point against the one below it, 0 first. */
export function steps(s: Pick<Series, 'points' | 'limits' | 'metric' | 'kTarget'>, m: Model, pts: number[]): Step[] {
  const cur = evalCurve(s, m)
  const sorted = [...new Set([0, ...pts])].sort((x, y) => x - y)
  return sorted.slice(1).map((b, i) => {
    const a = sorted[i]
    const row = pairRow(cur, a, b, s.metric, s.kTarget)
    const q = closenessQ(row, s.metric, s.kTarget)
    return { a, b, q, n: q * s.kTarget }
  })
}

/** Round concentrations (1-2-5 series) placed greedily from 0: each kept only when apart from the previous one. */
export function fill125(s: Pick<Series, 'points' | 'limits' | 'metric' | 'kTarget'>, m: Model, top: number): number[] {
  const cands: number[] = []
  const lo = Math.max(top / 1e4, 1e-6)
  for (let e = Math.floor(Math.log10(lo)); 10 ** e <= top * 1.0001; e++) for (const f of [1, 2, 5]) if (f * 10 ** e >= lo && f * 10 ** e <= top * 1.0001) cands.push(+(f * 10 ** e).toPrecision(2))
  const cur = evalCurve({ ...s, points: [] }, m)
  const out: number[] = []
  let prev = 0
  for (const c of cands) {
    const row = pairRow(cur, prev, c, s.metric, s.kTarget)
    if (closenessQ(row, s.metric, s.kTarget) >= 1) {
      out.push(c)
      prev = c
    }
  }
  return out
}
