import { compileExpr } from './expr'
import { makeInterp } from './interp'
import { normLevels, replicateStats, summaryPoints } from './tables'
import type { Layer, Series } from './types'

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
  /** within-run SD (the curve's own σ, before layers; spec §16) */
  sdWithin?: (c: number) => number
  /** mean(c)/sd(c) are defined beyond cMax (equations; tables continue the mean linearly, hold the SD) */
  extrapolates: boolean
}

function compileBase(s: Series): Model {
  if (s.mode === 'equations') {
    const levels = normLevels(s.levels)
    const cMax = s.cMax > 0 && Number.isFinite(s.cMax) ? s.cMax : levels[levels.length - 1] || 1
    const m = compileExpr(s.meanExpr, 'c')
    const d = compileExpr(s.sdExpr, 'S')
    const mean = m.ok ? m.fn : () => NaN
    const sd = m.ok && d.ok ? (c: number) => d.fn(m.fn(c)) : () => NaN
    return { mean, sd, levels, cMax, meanError: m.ok ? undefined : m.error, sdError: d.ok ? undefined : d.error, noSd: false, extrapolates: true }
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
  }
}

/** Spec §16.1 terms at signal mean mu with within-run SD sd: within variance and each layer's variance. */
export function layerTerms(mu: number, sd: number, mu0: number, layers: Layer[]): { within: number; terms: number[] } {
  let k2 = 1
  for (const l of layers) if (l.on) k2 *= 1 + l.noiseCv * l.noiseCv
  return {
    within: sd * sd * k2,
    terms: layers.map((l) => (mu - mu0) ** 2 * l.gainCv ** 2 + mu * mu * l.cv ** 2 + l.offsetSd ** 2),
  }
}

/** Compile a Series; with layers on, sd becomes the effective SD of spec §16.1 (sdWithin keeps the curve's σ). */
export function compileModel(s: Series): Model {
  const base = compileBase(s)
  const on = (s.layers ?? []).filter((l) => l.on)
  if (!on.length) return { ...base, sdWithin: base.sd }
  const mu0 = base.mean(0)
  const sd = (c: number) => {
    const mu = base.mean(c)
    const { within, terms } = layerTerms(mu, base.sd(c), mu0, on)
    return Math.sqrt(within + terms.reduce((a, b) => a + b, 0))
  }
  return { ...base, sd, sdWithin: base.sd }
}
