/**
 * Spec §15: detection limits (LoB / LoD / LoQ, CLSI EP17 style), the precision profile, the classical estimate from
 * blank / low-level replicates, and the simulated verification experiment (the planner).
 * Port of backend/app/limits.py (parity via spec/fixtures/model_vectors.json).
 */
import { inverse } from './analysis'
import { cTop, directionOf, hookOf, type Hook } from './hook'
import { summarise, type Q } from './experiment'
import type { Model } from './model'
import { makeNormal, mulberry32 } from './sim'
import { normCdf, normQuantile } from './specials'
import type { Series } from './types'

const SCAN = 2000
const BISECT = 60
const PROFILE_N = 200
const SLOPE_H = 1e-4

type Curve = Pick<Model, 'mean' | 'sd' | 'cMax' | 'sdReads'>

/** SD of `reads` averaged readings at c: within-run noise averages, layer terms do not (Model.sdReads). */
export const sdOfReads = (m: Curve, c: number, reads = 1): number => (m.sdReads ? m.sdReads(c, reads) : m.sd(c) / Math.sqrt(reads))

/** +1 when the signal rises with concentration (sandwich), −1 when it falls (competitive). */
export const direction = (m: Curve): 1 | -1 => directionOf(m)

/** d mean / dc by a central difference (one-sided at 0), step 1e-4·cMax. */
export function slope(m: Curve, c: number): number {
  const h = m.cMax * SLOPE_H
  const a = Math.max(c - h, 0)
  const b = c + h
  return (m.mean(b) - m.mean(a)) / (b - a)
}

/** CV of the read-back concentration at c: SD of `reads` averaged readings / (|slope|·c); ∞ at c = 0 or on a flat curve. */
export function concCv(m: Curve, c: number, reads = 1): number {
  const s = Math.abs(slope(m, c))
  if (!(c > 0 && s > 0)) return Infinity
  return sdOfReads(m, c, reads) / (s * c)
}

function first(pred: (c: number) => boolean, lo: number, hi: number): number | null {
  let prev = lo
  for (let j = 0; j <= SCAN; j++) {
    const c = lo + ((hi - lo) * j) / SCAN
    if (pred(c)) {
      if (j === 0) return c
      let a = prev
      let b = c
      for (let i = 0; i < BISECT; i++) {
        const mid = 0.5 * (a + b)
        if (pred(mid)) b = mid
        else a = mid
      }
      return b
    }
    prev = c
  }
  return null
}

function last(pred: (c: number) => boolean, lo: number, hi: number): number | null {
  let prev = hi
  for (let j = SCAN; j >= 0; j--) {
    const c = lo + ((hi - lo) * j) / SCAN
    if (pred(c)) {
      if (j === SCAN) return c
      let a = c
      let b = prev
      for (let i = 0; i < BISECT; i++) {
        const mid = 0.5 * (a + b)
        if (pred(mid)) a = mid
        else b = mid
      }
      return a
    }
    prev = c
  }
  return null
}

export interface LimitPoint {
  c: number
  signal: number
  cv: number
}

export interface Limits {
  alpha: number
  beta: number
  cv: number
  reads: number
  direction: 1 | -1
  blank: { mean: number; sd: number }
  lob: { signal: number; c: number | null }
  lod: LimitPoint | null
  loq: LimitPoint | null
  uloq: LimitPoint | null
  /** the high-dose hook's peak (§15.4); limits stop there */
  hook: Hook | null
  /** the CV is still within target at the top of the usable range: the true upper limit lies beyond (§15.2) */
  uloqOpen: boolean
  profile?: { c: number[]; cv: number[]; cvSignal: number[] }
}

export interface LimitArgs {
  alpha?: number
  beta?: number
  cv?: number
  reads?: number
  profile?: boolean
}

function check(alpha: number, beta: number, cv: number, reads: number) {
  if (!(alpha > 0 && alpha < 0.5 && beta > 0 && beta < 0.5)) throw new Error('alpha and beta must be between 0 and 0.5 (exclusive)')
  if (!(Number.isFinite(cv) && cv > 0)) throw new Error('cv must be > 0')
  if (!(Number.isInteger(reads) && reads >= 1 && reads <= 1000)) throw new Error('reads must be an integer between 1 and 1000')
}

export function limits(m: Curve, a: LimitArgs = {}): Limits {
  const alpha = a.alpha ?? 0.05
  const beta = a.beta ?? 0.05
  const cv = a.cv ?? 0.2
  const reads = a.reads ?? 1
  check(alpha, beta, cv, reads)
  const cMax = cTop(m) // claims stop at a hook's peak (§15.4)
  const d = direction(m)
  const sd = (c: number) => sdOfReads(m, c, reads)
  const mu0 = m.mean(0)
  const sd0 = sd(0)
  const za = normQuantile(1 - alpha)
  const zb = normQuantile(1 - beta)
  const lobS = mu0 + d * za * sd0
  const lobC = first((c) => d * (m.mean(c) - lobS) >= 0, 0, cMax)
  const lod = first((c) => d * (m.mean(c) - lobS) - zb * sd(c) >= 0, 0, cMax)
  const ok = (c: number) => concCv(m, c, reads) <= cv
  let loq: number | null = null
  let uloq: number | null = null
  if (lod !== null) {
    loq = first(ok, lod, cMax)
    if (loq !== null) uloq = last(ok, loq, cMax)
  }
  const at = (c: number | null): LimitPoint | null => (c === null ? null : { c, signal: m.mean(c), cv: concCv(m, c, reads) })
  const out: Limits = { alpha, beta, cv, reads, direction: d, blank: { mean: mu0, sd: sd0 }, lob: { signal: lobS, c: lobC }, lod: at(lod), loq: at(loq), uloq: at(uloq), hook: hookOf(m), uloqOpen: uloq !== null && uloq >= cMax }
  if (a.profile ?? true) {
    const cs: number[] = []
    const cvs: number[] = []
    const cvSignal: number[] = []
    for (let i = 0; i <= PROFILE_N; i++) {
      const c = (m.cMax * i) / PROFILE_N
      cs.push(c)
      cvs.push(concCv(m, c, reads))
      const mu = m.mean(c)
      cvSignal.push(mu !== 0 ? sd(c) / Math.abs(mu) : Infinity)
    }
    out.profile = { c: cs, cv: cvs, cvSignal }
  }
  return out
}

// ---------------------------------------------------------------- classical EP17 estimate from replicates

/** EP17 nonparametric percentile: rank position 0.5 + n·p (1-based), linear between neighbouring ranks. */
export function rankPercentile(values: number[], p: number): number {
  const v = [...values].sort((a, b) => a - b)
  const n = v.length
  const pos = Math.min(Math.max(0.5 + n * p, 1), n)
  const i = Math.floor(pos)
  const f = pos - i
  return v[i - 1] + (v[Math.min(i, n - 1)] - v[i - 1]) * f
}

function meanSd(v: number[]): [number, number] {
  const n = v.length
  const m = v.reduce((a, b) => a + b, 0) / n
  return [m, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1))]
}

export interface LimitsData {
  alpha: number
  beta: number
  direction: 1 | -1
  blank: { n: number; mean: number; sd: number }
  lob: { signal: number; signalNonparametric: number; c: number | null }
  low: { c: number; n: number; mean: number; sd: number }[]
  sdLow: number
  df: number
  lod: { signal: number; c: number | null }
}

/** Classical estimate from the entered replicates (null unless there is a blank and a low column with ≥ 2 readings). */
export function limitsData(s: Series, m: Model, alpha = 0.05, beta = 0.05, lowConcs?: number[] | null): LimitsData | null {
  check(alpha, beta, 0.2, 1)
  if (s.mode !== 'replicates' || m.adjusted) return null
  const cols = new Map<number, number[]>()
  s.replicates.concs.forEach((c, j) => {
    if (typeof c !== 'number' || !Number.isFinite(c)) return
    const ys = (s.replicates.cells[j] ?? []).filter((y): y is number => typeof y === 'number' && Number.isFinite(y))
    cols.set(c, [...(cols.get(c) ?? []), ...ys])
  })
  const blank = cols.get(0) ?? []
  if (blank.length < 2) return null
  const pos = [...cols.entries()].filter(([c, v]) => c > 0 && v.length >= 2).map(([c]) => c).sort((a, b) => a - b)
  const low = lowConcs ? lowConcs.filter((c) => pos.includes(c)) : pos.slice(0, 2)
  if (!low.length) return null
  const d = direction(m)
  const za = normQuantile(1 - alpha)
  const zb = normQuantile(1 - beta)
  const [mb, sb] = meanSd(blank)
  const nb = blank.length
  const lobS = mb + ((d * za) / (1 - 1 / (4 * (nb - 1)))) * sb
  const lobNp = rankPercentile(blank, d > 0 ? 1 - alpha : alpha)
  const rows: LimitsData['low'] = []
  let numr = 0
  let df = 0
  for (const c of low) {
    const ys = cols.get(c) as number[]
    const [mean, sd] = meanSd(ys)
    rows.push({ c, n: ys.length, mean, sd })
    numr += (ys.length - 1) * sd * sd
    df += ys.length - 1
  }
  const sdLow = Math.sqrt(numr / df)
  const lodS = lobS + ((d * zb) / (1 - 1 / (4 * df))) * sdLow
  return {
    alpha,
    beta,
    direction: d,
    blank: { n: nb, mean: mb, sd: sb },
    lob: { signal: lobS, signalNonparametric: lobNp, c: inverse(m, lobS) },
    low: rows,
    sdLow,
    df,
    lod: { signal: lodS, c: inverse(m, lodS) },
  }
}

// ---------------------------------------------------------------- planner

export interface PlanArgs {
  nBlank?: number
  nLow?: number
  low?: number[] | null
  runs?: number
  seed?: number
  alpha?: number
  beta?: number
  conf?: number
  /** CV allowed at the LoQ (fraction); the plan adds a sample at the LoQ to confirm it */
  cv?: number
}

export interface Plan {
  design: { rows: { sample: string; c: number; n: number }[]; strips: number }
  alpha: number
  beta: number
  runs: number
  seed: number
  conf: number
  truth: { lobSignal: number; lod: number | null }
  lobSignal: Q
  lodSignal: Q
  lod: Q
  lodFound: number
  detect: { c: number; truth: number | null; mean: number }[]
  /** the LoQ sample: how the measured CV of the result would scatter (null when the curve has no LoQ) */
  loq: { c: number; n: number; cvTarget: number; cvTruth: number; cv: Q; pPass: number } | null
  first: { lobSignal: number; lodSignal: number; lod: number | null }
}

const intIn = (x: number, what: string, lo: number, hi: number) => {
  if (!Number.isInteger(x)) throw new Error(`${what} must be an integer, got ${x}`)
  if (x < lo || x > hi) throw new Error(`${what} must be between ${lo} and ${hi}, got ${x}`)
  return x
}

/** Simulate the EP17 LoB / LoD experiment `runs` times (draw order per run: blanks, then each low concentration). */
export function plan(m: Curve, a: PlanArgs = {}): Plan {
  const alpha = a.alpha ?? 0.05
  const beta = a.beta ?? 0.05
  check(alpha, beta, 0.2, 1)
  const nBlank = intIn(a.nBlank ?? 20, 'nBlank', 2, 1000)
  const nLow = intIn(a.nLow ?? 20, 'nLow', 2, 1000)
  const runs = intIn(a.runs ?? 500, 'runs', 1, 5000)
  const seed = Math.floor(a.seed ?? 1)
  const conf = a.conf ?? 0.9
  if (!(conf > 0 && conf < 1)) throw new Error('conf must be between 0 and 1 (exclusive)')
  const cv = a.cv ?? 0.2
  const truth = limits(m, { alpha, beta, cv, profile: false })
  let low = a.low ?? null
  if (!low) {
    if (!truth.lod) throw new Error('no detection limit within the range: give the low concentrations to test')
    low = [+truth.lod.c.toPrecision(3), +(2 * truth.lod.c).toPrecision(3)]
  }
  if (!low.length || low.some((c) => !(Number.isFinite(c) && c > 0))) throw new Error('low concentrations must be finite and > 0')
  const d = truth.direction
  const za = normQuantile(1 - alpha)
  const zb = normQuantile(1 - beta)
  const k = low.length
  const z = makeNormal(mulberry32(seed))
  const mu0 = m.mean(0)
  const sd0 = m.sd(0)
  const muL = low.map((c) => m.mean(c))
  const sdL = low.map((c) => m.sd(c))
  // a sample at the LoQ, read nLow times: its measured result CV is the signal SD over |slope|·c (delta method)
  const cq = truth.loq ? +truth.loq.c.toPrecision(3) : null
  const muQ = cq === null ? 0 : m.mean(cq)
  const sdQ = cq === null ? 0 : m.sd(cq)
  const perCv = cq === null ? 0 : Math.abs(slope(m, cq)) * cq
  const cvs: number[] = []
  const lobs: number[] = []
  const lodsS: number[] = []
  const lodsC: number[] = []
  const detect = low.map(() => 0)
  const df = k * (nLow - 1)
  for (let r = 0; r < runs; r++) {
    const blanks: number[] = []
    for (let i = 0; i < nBlank; i++) blanks.push(mu0 + sd0 * z())
    const [mb, sb] = meanSd(blanks)
    const lobS = mb + ((d * za) / (1 - 1 / (4 * (nBlank - 1)))) * sb
    let v = 0
    for (let j = 0; j < k; j++) {
      const ys: number[] = []
      for (let i = 0; i < nLow; i++) ys.push(muL[j] + sdL[j] * z())
      const [, s] = meanSd(ys)
      v += s * s
      detect[j] += ys.filter((y) => d * (y - lobS) > 0).length / nLow
    }
    const lodS = lobS + ((d * zb) / (1 - 1 / (4 * df))) * Math.sqrt(v / k)
    if (cq !== null) {
      const ys: number[] = []
      for (let i = 0; i < nLow; i++) ys.push(muQ + sdQ * z())
      cvs.push(meanSd(ys)[1] / perCv)
    }
    const c = inverse(m, lodS)
    lobs.push(lobS)
    lodsS.push(lodS)
    lodsC.push(c === null ? NaN : c)
  }
  const trueLob = truth.lob.signal
  return {
    design: {
      rows: [{ sample: 'blank', c: 0, n: nBlank }, ...low.map((c, j) => ({ sample: `low ${j + 1}`, c, n: nLow })), ...(cq === null ? [] : [{ sample: 'LoQ', c: cq, n: nLow }])],
      strips: nBlank + (k + (cq === null ? 0 : 1)) * nLow,
    },
    alpha,
    beta,
    runs,
    seed,
    conf,
    truth: { lobSignal: trueLob, lod: truth.lod ? truth.lod.c : null },
    lobSignal: summarise(lobs, conf),
    lodSignal: summarise(lodsS, conf),
    lod: summarise(lodsC, conf),
    lodFound: lodsC.filter((c) => !Number.isNaN(c)).length / runs,
    detect: low.map((c, j) => ({ c, truth: sdL[j] > 0 ? normCdf((d * (muL[j] - trueLob)) / sdL[j]) : null, mean: detect[j] / runs })),
    loq: cq === null ? null : { c: cq, n: nLow, cvTarget: cv, cvTruth: concCv(m, cq), cv: summarise(cvs, conf), pPass: cvs.filter((x) => x <= cv).length / runs },
    first: { lobSignal: lobs[0], lodSignal: lodsS[0], lod: Number.isNaN(lodsC[0]) ? null : lodsC[0] },
  }
}
