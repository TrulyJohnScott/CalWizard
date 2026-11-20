/**
 * Spec section 13: simulated experiments. The model is the truth; each run draws n readings per concentration
 * (mulberry32 + Box–Muller, order run → concentration → replicate) and measures separation from the estimates.
 * Port of backend/app/experiment.py (parity via spec/fixtures/model_vectors.json `simulate`).
 */
import { passes } from './analysis'
import type { Model } from './model'
import { makeNormal, mulberry32 } from './sim'
import { studentTwoSided } from './specials'
import type { MetricKey } from './types'

export interface Q {
  lo: number | null
  med: number | null
  hi: number | null
  min: number | null
  max: number | null
}

export interface ExperimentArgs {
  concs?: number[]
  /** one n for all, or one per concentration (each 2…1000) */
  n?: number | number[]
  runs?: number
  seed?: number
  metric: MetricKey
  k: number
  conf?: number
  /** significance level for the Welch t-test power (default 0.05) */
  alpha?: number
}

/** Two-sided Welch t-test p-value from summary stats; both SDs 0: p = 0 if the means differ, else 1. */
export function welchP(m1: number, s1: number, n1: number, m2: number, s2: number, n2: number): number {
  const a = (s1 * s1) / n1
  const b = (s2 * s2) / n2
  const se = Math.sqrt(a + b)
  if (!(se > 0)) return m1 !== m2 ? 0 : 1
  const df = (a + b) ** 2 / ((a * a) / (n1 - 1) + (b * b) / (n2 - 1))
  return studentTwoSided(Math.abs(m2 - m1) / se, df)
}

export interface RunRow {
  c1: number
  c2: number
  dsum: number
  ssmd: number
  zprime: number
  value: number
  pass: boolean
  /** Welch t-test p-value for this pair in this run */
  p: number
}

export interface Experiment {
  concs: number[]
  n: number[]
  runs: number
  seed: number
  metric: MetricKey
  k: number
  conf: number
  alpha: number
  truth: { rows: { c1: number; c2: number; value: number; pass: boolean }[]; resolvedPairs: number }
  first: { levels: { c: number; ys: number[]; mean: number; sd: number }[]; rows: RunRow[]; resolvedPairs: number }
  levels: { c: number; mean: Q; sd: Q }[]
  /** pPass: share of runs meeting the metric target; pSig: share of runs where a Welch t-test finds p < alpha */
  pairs: ({ c1: number; c2: number; truth: number; pPass: number; pSig: number } & Q)[]
  resolvedPairs: Q & { hist: number[] }
  pAllPass: number
}

/** numpy `linear` quantile of finite values (sorted copy); null when none. */
export function quantile(values: number[], p: number): number | null {
  const v = values.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const pos = p * (v.length - 1)
  const i = Math.floor(pos)
  const f = pos - i
  return i + 1 < v.length ? v[i] + (v[i + 1] - v[i]) * f : v[i]
}

export function summarise(values: number[], conf: number): Q {
  const a = (1 - conf) / 2
  const v = values.filter((x) => !Number.isNaN(x))
  return {
    lo: quantile(v, a),
    med: quantile(v, 0.5),
    hi: quantile(v, 1 - a),
    min: v.length ? Math.min(...v) : null,
    max: v.length ? Math.max(...v) : null,
  }
}

const metricOf = (mu1: number, s1: number, mu2: number, s2: number) => {
  const d = mu2 - mu1
  return { dsum: d / (s1 + s2), ssmd: d / Math.sqrt(s1 * s1 + s2 * s2), zprime: 1 - (3 * (s1 + s2)) / Math.abs(d) }
}

/** Validation per §13; throws Error with the backend's wording. */
function normalise(m: Pick<Model, 'levels'>, a: ExperimentArgs) {
  const concs = [...new Set((a.concs ?? m.levels).filter((c) => Number.isFinite(c) && c >= 0))].sort((x, y) => x - y)
  if (a.concs && a.concs.some((c) => !(Number.isFinite(c) && c >= 0))) throw new Error('concentrations must be finite and >= 0')
  const nRaw = a.n ?? 4
  const n = Array.isArray(nRaw) ? nRaw.map((x) => Math.round(x)) : concs.map(() => Math.round(nRaw))
  if (n.length !== concs.length) throw new Error('n per concentration must match the concentrations')
  if (n.some((x) => !(x >= 2 && x <= 1000))) throw new Error('n must be between 2 and 1000')
  const runs = Math.round(a.runs ?? 200)
  if (!(runs >= 1 && runs <= 5000)) throw new Error('runs must be between 1 and 5000')
  const conf = a.conf ?? 0.9
  if (!(conf > 0 && conf < 1)) throw new Error('conf must be between 0 and 1')
  const alpha = a.alpha ?? 0.05
  if (!(alpha > 0 && alpha < 1)) throw new Error('alpha must be between 0 and 1')
  return { concs, n, runs, conf, alpha, seed: Math.floor(a.seed ?? 1) }
}

export function simulate(m: Pick<Model, 'mean' | 'sd' | 'levels'>, args: ExperimentArgs): Experiment {
  const { concs, n, runs, conf, alpha, seed } = normalise(m, args)
  const { metric, k } = args
  const mu = concs.map((c) => m.mean(c))
  const sd = concs.map((c) => m.sd(c))
  const z = makeNormal(mulberry32(seed))
  const P = Math.max(0, concs.length - 1)

  const truthRows = concs.slice(1).map((c2, i) => {
    const v = metricOf(mu[i], sd[i], mu[i + 1], sd[i + 1])[metric]
    return { c1: concs[i], c2, value: v, pass: passes(metric, v, k) }
  })

  const lvMean = concs.map(() => [] as number[])
  const lvSd = concs.map(() => [] as number[])
  const pairVals = Array.from({ length: P }, () => [] as number[])
  const pairPass = new Array(P).fill(0)
  const pairSig = new Array(P).fill(0)
  const resolved: number[] = []
  const hist = new Array(P + 1).fill(0)
  let allPass = 0
  let first: Experiment['first'] | null = null

  for (let r = 0; r < runs; r++) {
    const est = concs.map((c, j) => {
      const ys: number[] = []
      for (let i = 0; i < n[j]; i++) ys.push(mu[j] + sd[j] * z())
      const mean = ys.reduce((s, y) => s + y, 0) / ys.length
      const ss = ys.reduce((s, y) => s + (y - mean) ** 2, 0)
      return { c, ys, mean, sd: Math.sqrt(ss / (ys.length - 1)) }
    })
    est.forEach((e, j) => {
      lvMean[j].push(e.mean)
      lvSd[j].push(e.sd)
    })
    const rows: RunRow[] = []
    let ok = 0
    for (let i = 0; i < P; i++) {
      const v = metricOf(est[i].mean, est[i].sd, est[i + 1].mean, est[i + 1].sd)
      const value = v[metric]
      const pass = passes(metric, value, k)
      const p = welchP(est[i].mean, est[i].sd, n[i], est[i + 1].mean, est[i + 1].sd, n[i + 1])
      if (p < alpha) pairSig[i]++
      pairVals[i].push(value)
      if (pass) {
        pairPass[i]++
        ok++
      }
      rows.push({ c1: concs[i], c2: concs[i + 1], ...v, value, pass, p })
    }
    resolved.push(ok)
    hist[ok]++
    if (ok === P) allPass++
    if (r === 0) first = { levels: est, rows, resolvedPairs: ok }
  }

  return {
    concs,
    n,
    runs,
    seed,
    metric,
    k,
    conf,
    alpha,
    truth: { rows: truthRows, resolvedPairs: truthRows.filter((t) => t.pass).length },
    first: first!,
    levels: concs.map((c, j) => ({ c, mean: summarise(lvMean[j], conf), sd: summarise(lvSd[j], conf) })),
    pairs: truthRows.map((t, i) => ({ c1: t.c1, c2: t.c2, truth: t.value, pPass: pairPass[i] / runs, pSig: pairSig[i] / runs, ...summarise(pairVals[i], conf) })),
    resolvedPairs: { ...summarise(resolved, conf), hist },
    pAllPass: allPass / runs,
  }
}

/** Readings per column in replicates mode ("as measured"); null for columns with < 2 readings. */
export function measuredN(cells: (number | null)[][]): number[] {
  return cells.map((col) => col.filter((v) => v !== null && Number.isFinite(v)).length)
}
