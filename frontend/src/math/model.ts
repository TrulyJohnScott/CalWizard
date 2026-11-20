import { compileExpr } from './expr'
import { makeInterp } from './interp'
import { normLevels, replicateStats, summaryPoints } from './tables'
import { adjustActive, type Series } from './types'

/** The numbers behind an active what-if layer (spec §14). */
export interface AdjustParams {
  b0: number
  t0: number
  b1: number
  t1: number
  gain: number
  cScale: number
  sdScale: number
}

/** Spec section 1: compiled mean(c) / sd(c) for the active mode. */
export interface Model {
  mean: (c: number) => number
  sd: (c: number) => number
  /** always includes 0 when data allow, sorted unique */
  levels: number[]
  cMax: number
  /** per-field problems (bad expression / missing data) */
  meanError?: string
  sdError?: string
  /** table mode with no SD information at all (sd = 0) */
  noSd: boolean
  /** mean(c)/sd(c) are defined beyond cMax (equations; tables continue the mean linearly, hold the SD) */
  extrapolates: boolean
  /** a what-if layer is applied; `base` is the curve without it */
  adjusted: boolean
  adjust?: AdjustParams
  base?: { mean: (c: number) => number; sd: (c: number) => number }
}

function compileBase(s: Series): Model & { sdOfSignal?: (S: number) => number } {
  if (s.mode === 'equations') {
    const levels = normLevels(s.levels)
    const cMax = s.cMax > 0 && Number.isFinite(s.cMax) ? s.cMax : levels[levels.length - 1] || 1
    const m = compileExpr(s.meanExpr, 'c')
    const d = compileExpr(s.sdExpr, 'S')
    const mean = m.ok ? m.fn : () => NaN
    const sd = m.ok && d.ok ? (c: number) => d.fn(m.fn(c)) : () => NaN
    return {
      mean,
      sd,
      levels,
      cMax,
      meanError: m.ok ? undefined : m.error,
      sdError: d.ok ? undefined : d.error,
      noSd: false,
      extrapolates: true,
      adjusted: false,
      sdOfSignal: m.ok && d.ok ? d.fn : undefined,
    }
  }
  let pts: { c: number; mean: number; sd: number | null }[]
  if (s.mode === 'replicates') {
    const st = replicateStats(s.replicates)
    pts = st.map((p) => ({ c: p.c, mean: p.mean, sd: p.sd }))
    // header columns without replicates may carry a typed mean / sd (summary rows)
    const have = new Set(st.map((p) => p.c))
    pts.push(...summaryPoints(s.summary).filter((p) => !have.has(p.c) && s.replicates.concs.includes(p.c)))
  }
  else pts = summaryPoints(s.summary)
  const mean = makeInterp(pts.map((p) => [p.c, p.mean]), true)
  const sdPts = pts.filter((p) => p.sd !== null).map((p): [number, number] => [p.c, p.sd as number])
  const noSd = sdPts.length === 0
  const sd = noSd ? () => 0 : makeInterp(sdPts)
  const extra = (s.extraLevels ?? []).filter((c) => Number.isFinite(c) && c >= 0)
  const levels = [...new Set([...pts.map((p) => p.c), ...extra])].sort((a, b) => a - b)
  const cMax = levels.length ? levels[levels.length - 1] : 1
  return {
    mean,
    sd,
    levels,
    cMax: cMax > 0 ? cMax : 1,
    meanError: pts.length ? undefined : 'no data',
    noSd,
    extrapolates: true,
    adjusted: false,
  }
}

/**
 * Spec §14 (port of Model._apply_adjust): mean'(c) = B' + (f(c / xs) − B)·gain with B = f(0), T = f(cMax) of the
 * unadjusted curve; sd' = sdScale·σ(new signal) in equations mode, sdScale·sd(c / xs) in table modes.
 */
export function compileModel(s: Series): Model {
  const { sdOfSignal, ...base } = compileBase(s)
  const adj = s.adjust
  if (!adjustActive(adj)) return base
  const f = base.mean
  const g = base.sd
  const xs = adj.cScale > 0 && Number.isFinite(adj.cScale) ? adj.cScale : 1
  const ss = adj.sdScale >= 0 && Number.isFinite(adj.sdScale) ? adj.sdScale : 1
  const b0 = f(0)
  const t0 = f(base.cMax)
  const b1 = adj.bottom === null ? b0 : adj.bottom
  const t1 = adj.top === null ? t0 : adj.top
  const gain = Number.isFinite(t0 - b0) && t0 !== b0 ? (t1 - b1) / (t0 - b0) : 1
  const mean = (c: number) => b1 + (f(c / xs) - b0) * gain
  const sd = s.mode === 'equations' ? (sdOfSignal ? (c: number) => ss * sdOfSignal(mean(c)) : () => NaN) : (c: number) => ss * g(c / xs)
  return { ...base, mean, sd, adjusted: true, adjust: { b0, t0, b1, t1, gain, cScale: xs, sdScale: ss }, base: { mean: f, sd: g } }
}
