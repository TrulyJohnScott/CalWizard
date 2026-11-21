import { cTop, hookOf } from './hook'
import { normQuantile } from './specials'
import { ovlErr } from './metrics'
import type { Model } from './model'
import type { MetricKey } from './types'

export interface PairRow {
  c1: number
  c2: number
  mu1: number
  mu2: number
  sd1: number
  sd2: number
  dmu: number
  dsum: number
  ssmd: number
  zprime: number
  ovl: number
  err: number
  pass: boolean
}

export type Curve = Pick<Model, 'mean' | 'sd'>

/** Spec section 5: dsum/ssmd pass on |value| >= k, Z' on value >= k. */
export function passes(key: MetricKey, value: number, k: number): boolean {
  if (!Number.isFinite(value)) return false
  return key === 'zprime' ? value >= k : Math.abs(value) >= k
}

export function pairRow(m: Curve, c1: number, c2: number, metric: MetricKey, k: number): PairRow {
  const mu1 = m.mean(c1)
  const mu2 = m.mean(c2)
  const sd1 = m.sd(c1)
  const sd2 = m.sd(c2)
  const dmu = mu2 - mu1
  const dsum = dmu / (sd1 + sd2)
  const ssmd = dmu / Math.sqrt(sd1 * sd1 + sd2 * sd2)
  const zprime = 1 - (3 * (sd1 + sd2)) / Math.abs(dmu)
  const { ovl, err } = ovlErr(mu1, sd1, mu2, sd2)
  const row = { c1, c2, mu1, mu2, sd1, sd2, dmu, dsum, ssmd, zprime, ovl, err, pass: false }
  row.pass = passes(metric, row[metric], k)
  return row
}

/** Rows for adjacent concentrations in `concs` (sorted ascending by the caller). */
export function pairRows(m: Curve, concs: number[], metric: MetricKey, k: number): PairRow[] {
  const out: PairRow[] = []
  for (let i = 0; i + 1 < concs.length; i++) out.push(pairRow(m, concs[i], concs[i + 1], metric, k))
  return out
}

/** Spec section 6: first c in [0, cMax] with mean(c) = S (2001-point scan, 60 bisections), else null. */
export function inverse(m: Pick<Model, 'mean' | 'cMax'>, S: number): number | null {
  const N = 2000
  const f = (c: number) => m.mean(c) - S
  let c0 = 0
  let f0 = f(0)
  for (let i = 0; i <= N; i++) {
    const c1 = (m.cMax * i) / N
    const f1 = i === 0 ? f0 : f(c1)
    if (i === 0) {
      if (f0 === 0) return 0
      continue
    }
    if (Number.isFinite(f0) && Number.isFinite(f1) && (f1 === 0 || f0 * f1 < 0)) {
      if (f1 === 0) return c1
      let lo = c0
      let hi = c1
      let flo = f0
      for (let k = 0; k < 60; k++) {
        const mid = 0.5 * (lo + hi)
        const fm = f(mid)
        if (fm === 0) return mid
        if (flo * fm < 0) hi = mid
        else {
          lo = mid
          flo = fm
        }
      }
      return 0.5 * (lo + hi)
    }
    c0 = c1
    f0 = f1
  }
  return null
}

/** Metric value only (no overlap integral): cheap enough for scans. */
export function metricValue(m: Curve, c1: number, c2: number, metric: MetricKey): number {
  const d = m.mean(c2) - m.mean(c1)
  const s1 = m.sd(c1)
  const s2 = m.sd(c2)
  if (metric === 'dsum') return d / (s1 + s2)
  if (metric === 'ssmd') return d / Math.sqrt(s1 * s1 + s2 * s2)
  return 1 - (3 * (s1 + s2)) / Math.abs(d)
}

/**
 * Ladder: starting at `from` (default 0), c_{i+1} is the smallest c in (c_i, cMax] whose pair (c_i, c)
 * passes the metric at k. 2001-point scan on (c_i, cMax] then 60 bisections on the first passing bracket;
 * stops when none passes. Returns the list of levels including `from`. With `sig` > 0 levels are rounded
 * up to that many significant digits.
 */
export function ladder(m: Curve & { cMax: number }, metric: MetricKey, k: number, sig = 0, maxLevels = 200, from = 0, stop?: number): number[] {
  const out = [from]
  const top = stop ?? cTop(m) // by default a hook's peak ends the ladder (§15.4)
  const N = 2000
  const ok = (a: number, b: number) => passes(metric, metricValue(m, a, b, metric), k)
  while (out.length < maxLevels) {
    const a = out[out.length - 1]
    if (!(a < top)) break
    let lo = a
    let hit = -1
    for (let j = 1; j <= N; j++) {
      const c = a + ((top - a) * j) / N
      if (ok(a, c)) {
        hit = c
        break
      }
      lo = c
    }
    if (hit < 0) break
    let hi = hit
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi)
      if (ok(a, mid)) hi = mid
      else lo = mid
    }
    if (sig > 0) {
      // round up to `sig` significant digits (keeps the pair passing) so the list reads cleanly
      const p = Math.pow(10, sig - 1 - Math.floor(Math.log10(hi)))
      const up = Math.ceil(hi * p - 1e-9) / p
      if (up <= top && ok(a, up)) hi = up
    }
    if (!(hi > a)) break
    out.push(hi)
  }
  return out
}

export interface Recovery {
  signal: number
  c: number | null
  lo: number | null
  hi: number | null
  loOpen: boolean
  hiOpen: boolean
  conf: number
  /** the signal is also produced above a hook's peak: the reading is ambiguous (§15.4) */
  hook: boolean
}

/**
 * Spec section 12 (recovery): c = inverse(S); range = hull of {c in [0, cMax] : |S - mean(c)| <= z sd(c)},
 * z = Phi^-1(1 - (1 - conf)/2); 2001-point scan then 60 bisections at each end. Port of analysis.recover.
 */
export function recover(m: Pick<Model, 'mean' | 'sd' | 'cMax'>, S: number, conf = 0.95): Recovery {
  const row: Recovery = { signal: S, c: inverse(m, S), lo: null, hi: null, loOpen: false, hiOpen: false, conf, hook: false }
  if (!Number.isFinite(S) || !(conf > 0 && conf < 1)) return row
  const z = normQuantile(1 - (1 - conf) / 2)
  const N = 2000
  const ok = (c: number) => Math.abs(S - m.mean(c)) <= z * m.sd(c)
  const hk = hookOf(m)
  const top = hk ? hk.c : m.cMax // the usable range (§15.4)
  if (hk) for (let j = 1; j <= N && !row.hook; j++) row.hook = ok(hk.c + ((m.cMax - hk.c) * j) / N)
  const at = (j: number) => (top * j) / N
  let first = -1
  let last = -1
  for (let j = 0; j <= N; j++)
    if (ok(at(j))) {
      if (first < 0) first = j
      last = j
    }
  if (first < 0) return row
  let lo = at(first)
  if (first > 0) {
    let a = at(first - 1)
    let b = lo
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (a + b)
      if (ok(mid)) b = mid
      else a = mid
    }
    lo = b
  }
  let hi = at(last)
  if (last < N) {
    let a = hi
    let b = at(last + 1)
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (a + b)
      if (ok(mid)) a = mid
      else b = mid
    }
    hi = a
  }
  return { ...row, lo, hi, loOpen: first === 0, hiOpen: last === N }
}

export interface WhyNot {
  /** |Δμ| the pair would need at its current SDs (null when unreachable, e.g. Z′ with k ≥ 1) */
  needDmu: number | null
  dmu: number
  /** multiply both SDs by this to pass at the current Δμ (= closeness q); null if Δμ = 0 */
  sdScale: number | null
  /** smallest c above c1 that passes against c1 (within cMax), else null */
  moveTo: number | null
}

/** Spec section 12 "why not resolved": what would make a failing pair pass. */
export function whyNot(m: Curve & { cMax: number }, c1: number, c2: number, metric: MetricKey, k: number): WhyNot {
  const r = pairRow(m, c1, c2, metric, k)
  const s1 = r.sd1
  const s2 = r.sd2
  const needDmu = metric === 'dsum' ? k * (s1 + s2) : metric === 'ssmd' ? k * Math.sqrt(s1 * s1 + s2 * s2) : k < 1 ? (3 * (s1 + s2)) / (1 - k) : null
  const q = metric === 'zprime' ? (k < 1 ? Math.abs(r.dsum) / (3 / (1 - k)) : NaN) : Math.abs(r[metric]) / k
  const L = ladder(m, metric, k, 0, 2, c1)
  return { needDmu: needDmu !== null && needDmu > 0 ? needDmu : needDmu === null ? null : 0, dmu: Math.abs(r.dmu), sdScale: Number.isFinite(q) && q > 0 ? q : null, moveTo: L.length > 1 ? L[1] : null }
}

/** Closeness of the pair (a, b) in target units: q = |metric| / k (Z′: |dsum| / (3/(1 − k)); none for k ≥ 1). */
function unitsBetween(m: Curve, a: number, b: number, metric: MetricKey, k: number): number {
  if (metric === 'zprime') return k < 1 ? Math.abs(metricValue(m, a, b, 'dsum')) / (3 / (1 - k)) : NaN
  return k > 0 ? Math.abs(metricValue(m, a, b, metric)) / k : NaN
}

/**
 * Resolvable-unit ticks from an anchor: tick j (1…maxJ) is the smallest c in (anchor, stop] whose separation from the
 * anchor is j target units (q = j). 2000-point scan + 50 bisections per tick; ticks beyond stop are omitted.
 */
export function unitTicks(m: Curve, anchor: number, metric: MetricKey, k: number, stop: number, maxJ = 5): number[] {
  const N = 2000
  const xs: number[] = []
  const qs: number[] = []
  for (let i = 1; i <= N; i++) {
    const x = anchor + ((stop - anchor) * i) / N
    xs.push(x)
    qs.push(unitsBetween(m, anchor, x, metric, k))
  }
  const out: number[] = []
  let from = 0
  for (let j = 1; j <= maxJ; j++) {
    let hit = -1
    for (let i = from; i < N; i++)
      if (qs[i] >= j) {
        hit = i
        break
      }
    if (hit < 0) break
    let lo = hit === 0 ? anchor : xs[hit - 1]
    let hi = xs[hit]
    for (let t = 0; t < 50; t++) {
      const mid = 0.5 * (lo + hi)
      if (unitsBetween(m, anchor, mid, metric, k) >= j) hi = mid
      else lo = mid
    }
    out.push(hi)
    from = hit
  }
  return out
}

/**
 * Local resolution: the smallest Δc > 0 such that c and c + Δc are one target unit apart (closeness q = 1), searched
 * up to `stop` (coarse scan of `n` points + 30 bisections). Infinity when nothing within `stop` resolves from c.
 */
export function resolutionAt(m: Curve, c: number, metric: MetricKey, k: number, stop: number, n = 400): number {
  const q = (x: number) => unitsBetween(m, c, x, metric, k)
  let prev = c
  for (let i = 1; i <= n; i++) {
    const x = c + ((stop - c) * i) / n
    if (q(x) >= 1) {
      let lo = prev
      let hi = x
      for (let t = 0; t < 30; t++) {
        const mid = 0.5 * (lo + hi)
        if (q(mid) >= 1) hi = mid
        else lo = mid
      }
      return hi - c
    }
    prev = x
  }
  return Infinity
}

/**
 * Background closeness from local resolution: r = Δc / max(c, cRef) (the relative change resolvable at c; cRef keeps
 * c → 0 finite) mapped to the closeness scale q = 0.5 / r, so ±50% is the edge (q = 1), ±25% clear blue (q = 2),
 * c vs 2c orange (q = 0.5), unresolvable red (q = 0).
 */
export function resolutionQ(dc: number, c: number, cRef: number): number {
  if (!Number.isFinite(dc)) return 0
  const r = dc / Math.max(c, cRef)
  return r > 0 ? 0.5 / r : 2
}

