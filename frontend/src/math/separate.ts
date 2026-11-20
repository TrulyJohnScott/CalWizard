/**
 * Spec §16: two concentrations in depth. Port of backend analysis.separate (parity via the fixtures).
 */
import { ladder, pairRow, recover, whyNot, type PairRow, type Recovery, type WhyNot } from './analysis'
import { closenessQ } from './closeness'
import { simulate } from './experiment'
import type { Model } from './model'
import { normCdf } from './specials'
import type { MetricKey } from './types'

/** PDF crossing point between the means (midpoint for equal SDs or no root). Port of metrics.crossing. */
export function crossing(mu1: number, s1: number, mu2: number, s2: number): number {
  const mid = 0.5 * (mu1 + mu2)
  if (s1 <= 0 || s2 <= 0 || Math.abs(s1 - s2) < 1e-12 * (s1 + s2)) return mid
  const A = 1 / s1 ** 2 - 1 / s2 ** 2
  const B = (-2 * mu1) / s1 ** 2 + (2 * mu2) / s2 ** 2
  const C = mu1 ** 2 / s1 ** 2 - mu2 ** 2 / s2 ** 2 - 2 * Math.log(s2 / s1)
  const disc = Math.max(B * B - 4 * A * C, 0)
  const lo = Math.min(mu1, mu2)
  const hi = Math.max(mu1, mu2)
  for (const r of [(-B + Math.sqrt(disc)) / (2 * A), (-B - Math.sqrt(disc)) / (2 * A)]) if (lo <= r && r <= hi) return r
  return mid
}

export interface Separation extends PairRow {
  metric: MetricKey
  k: number
  stepsBetween: number
  whyNot: WhyNot
  /** in target units: ≥ 1 resolved */
  closeness: number
  /** signal cut-off between the two (where their densities cross) */
  threshold: number
  sensitivity: number
  specificity: number
  auc: number
  dprime: number
  cv1: number | null
  cv2: number | null
  fold: number | null
  /** readings to average per sample for the pair to pass the rule (null: unreachable) */
  nNeeded: number | null
  readback: [Recovery, Recovery]
  power: { n: number; runs: number; seed: number; alpha: number; pSig: number; pPass: number }
}

export interface SeparateArgs {
  n?: number
  runs?: number
  seed?: number
  conf?: number
  alpha?: number
}

export function separate(m: Pick<Model, 'mean' | 'sd' | 'cMax' | 'levels'>, c1: number, c2: number, metric: MetricKey, k: number, a: SeparateArgs = {}): Separation {
  if (!(Number.isFinite(c1) && Number.isFinite(c2) && c1 >= 0 && c2 >= 0) || c1 === c2) throw new Error('separate needs two different finite concentrations >= 0')
  const n = a.n ?? 3
  const alpha = a.alpha ?? 0.05
  const conf = a.conf ?? 0.95
  const row = pairRow(m, c1, c2, metric, k)
  const { mu1, mu2, sd1: s1, sd2: s2 } = row
  const lo = mu1 <= mu2 ? { m: mu1, s: s1 } : { m: mu2, s: s2 }
  const hi = mu1 <= mu2 ? { m: mu2, s: s2 } : { m: mu1, s: s1 }
  const t = crossing(mu1, s1, mu2, s2)
  const v = s1 * s1 + s2 * s2
  const sensitivity = hi.s > 0 ? 1 - normCdf((t - hi.m) / hi.s) : hi.m > t ? 1 : 0.5
  const specificity = lo.s > 0 ? normCdf((t - lo.m) / lo.s) : lo.m < t ? 1 : 0.5
  const auc = v > 0 ? normCdf(Math.abs(mu2 - mu1) / Math.sqrt(v)) : mu1 !== mu2 ? 1 : 0.5
  const dprime = v > 0 ? Math.abs(mu2 - mu1) / Math.sqrt(v / 2) : Infinity
  const q = closenessQ(row, metric, k)
  let nNeeded: number | null = null
  if (Number.isFinite(q) && q > 0) {
    nNeeded = Math.max(1, Math.ceil(1 / (q * q) - 1e-9))
    if (nNeeded > 100000) nNeeded = null
  }
  const cLo = Math.min(c1, c2)
  const cHi = Math.max(c1, c2)
  const sim = simulate(m, { concs: [cLo, cHi], n, runs: a.runs ?? 1000, seed: a.seed ?? 1, metric, k, alpha })
  return {
    ...row,
    metric,
    k,
    stepsBetween: ladder({ mean: m.mean, sd: m.sd, cMax: cHi }, metric, k, 0, 200, cLo).length - 1,
    whyNot: whyNot(m, c1, c2, metric, k),
    closeness: q,
    threshold: t,
    sensitivity,
    specificity,
    auc,
    dprime,
    cv1: mu1 !== 0 ? s1 / Math.abs(mu1) : null,
    cv2: mu2 !== 0 ? s2 / Math.abs(mu2) : null,
    fold: c1 > 0 ? c2 / c1 : null,
    nNeeded,
    readback: [recover(m, mu1, conf), recover(m, mu2, conf)],
    power: { n, runs: sim.runs, seed: sim.seed, alpha, pSig: sim.pairs[0].pSig, pPass: sim.pairs[0].pPass },
  }
}
