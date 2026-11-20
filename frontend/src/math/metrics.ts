import { normCdf, normSf } from './specials'
import type { MetricKey } from './types'

export const METRIC_LABEL: Record<MetricKey, string> = {
  dsum: 'Δμ/Σσ',
  ssmd: 'SSMD',
  zprime: 'Z′',
}

/** Probability mass of N(mu, s) on [a, b], tail-accurate. */
function mass(a: number, b: number, mu: number, s: number): number {
  const za = (a - mu) / s
  const zb = (b - mu) / s
  return za >= 0 ? normSf(za) - normSf(zb) : normCdf(zb) - normCdf(za)
}

const logPdf = (x: number, m: number, s: number) => -0.5 * ((x - m) / s) ** 2 - Math.log(s)

/** Roots of p1(t) = p2(t) for two normals. */
function crossings(m1: number, s1: number, m2: number, s2: number): number[] {
  const A = 1 / (2 * s1 * s1) - 1 / (2 * s2 * s2)
  const B = -m1 / (s1 * s1) + m2 / (s2 * s2)
  const C = (m1 * m1) / (2 * s1 * s1) - (m2 * m2) / (2 * s2 * s2) + Math.log(s1) - Math.log(s2)
  const scale = 1 / (2 * s1 * s1) + 1 / (2 * s2 * s2)
  if (Math.abs(A) < 1e-12 * scale) return Number.isFinite(-C / B) ? [-C / B] : []
  const disc = B * B - 4 * A * C
  if (disc < 0) return []
  const sq = Math.sqrt(disc)
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].sort((x, y) => x - y)
}

export interface OvlErr {
  ovl: number
  err: number
  /** PDF crossing used as the decision threshold. */
  t: number
}

/**
 * Overlap coefficient and misclassification rate (spec section 10).
 * ovl = integral of min(p1, p2); err = 0.5 (P(X_lo > t) + P(X_hi < t)) at the PDF crossing t between the means.
 */
export function ovlErr(mu1: number, sd1: number, mu2: number, sd2: number): OvlErr {
  const floor = (m: number) => 1e-9 * Math.max(Math.abs(m), 1)
  const s1 = Math.max(sd1, floor(mu1))
  const s2 = Math.max(sd2, floor(mu2))
  const lo = mu1 <= mu2 ? { m: mu1, s: s1 } : { m: mu2, s: s2 }
  const hi = mu1 <= mu2 ? { m: mu2, s: s2 } : { m: mu1, s: s1 }
  if (hi.m - lo.m < 1e-12 * Math.max(Math.abs(lo.m), 1) && Math.abs(hi.s - lo.s) < 1e-12 * lo.s) {
    return { ovl: 1, err: 0.5, t: lo.m }
  }
  const roots = crossings(lo.m, lo.s, hi.m, hi.s)
  // overlap: integrate whichever pdf is lower on each interval between crossings
  const edges = [-Infinity, ...roots, Infinity]
  const sMax = Math.max(lo.s, hi.s)
  let ovl = 0
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i]
    const b = edges[i + 1]
    const mid = a === -Infinity ? b - sMax : b === Infinity ? a + sMax : 0.5 * (a + b)
    const useLo = logPdf(mid, lo.m, lo.s) <= logPdf(mid, hi.m, hi.s)
    ovl += useLo ? mass(a, b, lo.m, lo.s) : mass(a, b, hi.m, hi.s)
  }
  // threshold between the means
  const mid = 0.5 * (lo.m + hi.m)
  const between = roots.filter((r) => r >= lo.m && r <= hi.m)
  let t = mid // no crossing between the means: midpoint (matches backend)
  if (between.length) t = between.reduce((best, r) => (Math.abs(r - mid) < Math.abs(best - mid) ? r : best), between[0])
  const err = 0.5 * (normSf((t - lo.m) / lo.s) + normCdf((t - hi.m) / hi.s))
  return { ovl: Math.min(1, Math.max(0, ovl)), err, t }
}
