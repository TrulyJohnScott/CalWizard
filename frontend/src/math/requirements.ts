/**
 * Spec §17: client requirements checked against the curve. Port of backend/app/requirements.py.
 */
import { ladder, metricValue } from './analysis'
import { cTop } from './hook'
import { concCv, limits, sdOfReads } from './limits'
import type { Model } from './model'
import type { Requirement, Series } from './types'

const SD_BISECT = 40
const SD_FLOOR = 0.01
const RANGE_N = 200
const MAX_LEVELS = 200

type Curve = Pick<Model, 'mean' | 'sd' | 'cMax' | 'sdReads'>

export interface RequirementResult extends Requirement {
  ok: boolean
  /** detect: LoD · distinguish: metric value · precision: CV · range: LoQ · levels: resolvable levels */
  value: number | null
  /** 1 when met; else the largest factor on every SD that makes it met; null when even ×0.01 does not */
  sdScale: number | null
  error: string | null
}

const pos = (v: number | null | undefined, zeroOk = false): v is number => typeof v === 'number' && Number.isFinite(v) && (zeroOk ? v >= 0 : v > 0)

export function requirementError(r: Requirement): string | null {
  if (r.kind === 'detect' && !pos(r.c)) return 'needs a concentration c > 0'
  if (r.kind === 'distinguish' && !(pos(r.c, true) && pos(r.c2, true) && r.c !== r.c2)) return 'needs two different concentrations c and c2'
  if (r.kind === 'precision' && !(pos(r.c) && pos(r.cv))) return 'needs a concentration c > 0 and a cv > 0'
  if (r.kind === 'range' && !(pos(r.c) && pos(r.c2) && r.c2 > r.c)) return 'needs c < c2 (both > 0)'
  if (r.kind === 'levels' && !(typeof r.n === 'number' && r.n >= 1)) return 'needs n >= 1'
  return null
}

function evaluate(m: Curve, r: Requirement, s: Pick<Series, 'limits' | 'metric' | 'kTarget'>, quick = false): [boolean, number | null] {
  const lim = s.limits
  // every kind is judged on one result = the average of `reads` readings (spec §17)
  const perResult: Curve = lim.reads === 1 ? m : { mean: m.mean, cMax: m.cMax, sd: (c) => sdOfReads(m, c, lim.reads) }
  if (r.kind === 'detect') {
    const lod = limits(m, { ...lim, profile: false }).lod
    return [lod !== null && lod.c <= (r.c as number), lod ? lod.c : null]
  }
  if (r.kind === 'distinguish') {
    const v = metricValue(perResult, r.c as number, r.c2 as number, s.metric)
    return [Number.isNaN(v) ? false : s.metric === 'zprime' ? v >= s.kTarget : Math.abs(v) >= s.kTarget, v]
  }
  if (r.kind === 'precision') {
    const v = concCv(m, r.c as number, lim.reads)
    return [v <= (r.cv as number), v]
  }
  if (r.kind === 'range') {
    // the worst CV across [c, c2] (RANGE_N + 1 points), within the usable range (§17)
    if ((r.c2 as number) > cTop(m)) return [false, null]
    let worst = 0
    for (let j = 0; j <= RANGE_N; j++) worst = Math.max(worst, concCv(m, (r.c as number) + (((r.c2 as number) - (r.c as number)) * j) / RANGE_N, lim.reads))
    return [worst <= (r.cv ?? lim.cv), Number.isFinite(worst) ? worst : null]
  }
  const need = r.n as number
  if (quick) return [ladder(perResult, s.metric, s.kTarget, 4, Math.min(need, MAX_LEVELS)).length >= need, null]
  const n = ladder(perResult, s.metric, s.kTarget, 4).length
  return [n >= need, n]
}

export interface RequirementCheck {
  results: RequirementResult[]
  met: number
  total: number
}

export function checkRequirements(s: Pick<Series, 'limits' | 'metric' | 'kTarget' | 'requirements'>, m: Curve): RequirementCheck {
  const results = s.requirements.map((r): RequirementResult => {
    const base = { kind: r.kind, c: r.c ?? null, c2: r.c2 ?? null, cv: r.cv ?? null, n: r.n ?? null, label: r.label ?? '' }
    const error = requirementError(r)
    if (error) return { ...base, ok: false, value: null, sdScale: null, error }
    const [ok, value] = evaluate(m, r, s)
    let sdScale: number | null = ok ? 1 : null
    const scaled = (f: number): Curve => ({ mean: m.mean, cMax: m.cMax, sd: (c) => f * m.sd(c), sdReads: (c, k) => f * sdOfReads(m, c, k) })
    if (!ok && evaluate(scaled(SD_FLOOR), r, s, true)[0]) {
      let lo = SD_FLOOR
      let hi = 1
      for (let i = 0; i < SD_BISECT; i++) {
        const mid = 0.5 * (lo + hi)
        if (evaluate(scaled(mid), r, s, true)[0]) lo = mid
        else hi = mid
      }
      sdScale = lo
    }
    return { ...base, ok, value, sdScale, error: null }
  })
  return { results, met: results.filter((r) => r.ok).length, total: results.length }
}
