/**
 * Repeat the calibration (core design): treat the curve as the truth, re-run the calibration design (the data's own
 * concentrations and replicate counts, or 0, 1, 5, 25, 100, 500 × 3 for a function) N times, and rebuild each run's
 * curve the way the data defines it: means joined by straight lines, the SD per concentration interpolated in CV.
 * Reports how often each of your steps stays apart, where the LoD lands, and how a reading moves.
 */
import { limits } from '../math/limits'
import type { Model } from '../math/model'
import { makeNormal, mulberry32 } from '../math/sim'
import type { Series } from '../math/types'
import { steps } from './points'

export const DEFAULT_DESIGN = { concs: [0, 1, 5, 25, 100, 500], n: 3 }

export interface RepeatResult {
  concs: number[]
  /** one array of mean signals per run, aligned with concs */
  runs: number[][]
  /** per step of your points: share of runs in which it is apart */
  stable: { a: number; b: number; share: number }[]
  /** LoD across runs: 5th and 95th percentile (null when too few runs found one) */
  lod: [number, number] | null
  /** a reading at the true signal of `at`, read back on each run's curve: 5th and 95th percentile */
  at: number | null
  back: [number, number] | null
}

const quantile = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b)
  const x = p * (s.length - 1)
  const i = Math.floor(x)
  return i + 1 < s.length ? s[i] + (x - i) * (s[i + 1] - s[i]) : s[i]
}

/** Piecewise-linear y(x) through sorted xs; held flat beyond the ends. */
function lin(xs: number[], ys: number[]) {
  return (x: number) => {
    if (x <= xs[0]) return ys[0]
    for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1])
    return ys[ys.length - 1]
  }
}

/** Read a signal back on a piecewise-linear curve through (concs, ys); null outside it. */
function invertLinear(concs: number[], ys: number[], S: number): number | null {
  for (let i = 1; i < concs.length; i++) {
    const a = ys[i - 1]
    const b = ys[i]
    if ((S - a) * (S - b) <= 0 && a !== b) return concs[i - 1] + ((S - a) / (b - a)) * (concs[i] - concs[i - 1])
  }
  return null
}

/** The calibration design to repeat: the data's concentrations and replicate counts, else the default. */
export function designOf(s: Series): { concs: number[]; n: number[] } {
  if (s.mode === 'replicates') {
    const cs = s.replicates.concs.map((c, j) => ({ c, n: (s.replicates.cells[j] ?? []).filter((v) => v !== null && Number.isFinite(v)).length })).filter((x) => x.c !== null && Number.isFinite(x.c as number) && x.n > 0)
    if (cs.length >= 2) return { concs: cs.map((x) => x.c as number), n: cs.map((x) => Math.max(2, x.n)) }
  }
  if (s.mode === 'summary') {
    const cs = s.summary.map((r) => r.c).filter((c): c is number => c !== null && Number.isFinite(c))
    if (cs.length >= 2) return { concs: cs, n: cs.map(() => DEFAULT_DESIGN.n) }
  }
  return { concs: DEFAULT_DESIGN.concs, n: DEFAULT_DESIGN.concs.map(() => DEFAULT_DESIGN.n) }
}

export function repeatRuns(s: Series, m: Model, pts: number[], runs: number, at: number | null, seed = 7): RepeatResult {
  const design = designOf(s)
  const order = design.concs.map((c, j) => ({ c, n: design.n[j] })).sort((a, b) => a.c - b.c)
  const cs = order.map((x) => x.c)
  const norm = makeNormal(mulberry32(seed))
  const means: number[][] = []
  const yourSteps = steps(s, m, pts)
  const apart = yourSteps.map(() => 0)
  const lods: number[] = []
  const backs: number[] = []
  const S = at !== null ? m.mean(at) : null
  const lodRuns = Math.min(runs, 200) // limits are the slow part
  for (let r = 0; r < runs; r++) {
    const mu: number[] = []
    const cv: number[] = []
    for (const { c, n } of order) {
      const xs: number[] = []
      for (let j = 0; j < n; j++) xs.push(m.mean(c) + m.sd(c) * norm())
      const mean = xs.reduce((a, b) => a + b, 0) / n
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
      mu.push(mean)
      cv.push(mean !== 0 ? sd / Math.abs(mean) : 0)
    }
    means.push(mu)
    const meanF = lin(cs, mu)
    const cvF = lin(cs, cv)
    const run: Model = { ...m, mean: meanF, sd: (c: number) => cvF(c) * Math.abs(meanF(c)), sdReads: undefined, sdWithin: undefined, adjusted: false }
    if (pts.length) steps({ ...s, points: s.points }, run, pts).forEach((x, i) => (apart[i] += x.q >= 1 ? 1 : 0))
    if (r < lodRuns) {
      try {
        const l = limits(run, { ...s.limits, profile: false }).lod
        if (l) lods.push(l.c)
      } catch {
        /* no limit in this run */
      }
    }
    if (S !== null) {
      const b = invertLinear(cs, mu, S)
      if (b !== null) backs.push(b)
    }
  }
  return {
    concs: cs,
    runs: means,
    stable: yourSteps.map((x, i) => ({ a: x.a, b: x.b, share: apart[i] / runs })),
    lod: lods.length >= Math.max(10, lodRuns / 2) ? [quantile(lods, 0.05), quantile(lods, 0.95)] : null,
    at,
    back: backs.length >= Math.max(10, runs / 2) ? [quantile(backs, 0.05), quantile(backs, 0.95)] : null,
  }
}
