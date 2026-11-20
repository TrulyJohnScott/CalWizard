/**
 * Spec §17: client requirements checked against the curve. Port of backend/app/requirements.py.
 */
import { ladder, metricValue } from './analysis'
import { concCv, limits } from './limits'
import type { Model } from './model'
import type { Requirement, Series } from './types'

const SD_BISECT = 40
const SD_FLOOR = 0.01
const MAX_LEVELS = 200

type Curve = Pick<Model, 'mean' | 'sd' | 'cMax'>

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
  if (r.kind === 'detect') {
    const lod = limits(m, { ...lim, profile: false }).lod
    return [lod !== null && lod.c <= (r.c as number), lod ? lod.c : null]
  }
  if (r.kind === 'distinguish') {
    const v = metricValue(m, r.c as number, r.c2 as number, s.metric)
    return [Number.isNaN(v) ? false : s.metric === 'zprime' ? v >= s.kTarget : Math.abs(v) >= s.kTarget, v]
  }
  if (r.kind === 'precision') {
    const v = concCv(m, r.c as number, lim.reads)
    return [v <= (r.cv as number), v]
  }
  if (r.kind === 'range') {
    const res = limits(m, { ...lim, cv: r.cv ?? lim.cv, profile: false })
    const ok = res.loq !== null && res.uloq !== null && res.loq.c <= (r.c as number) && res.uloq.c >= (r.c2 as number)
    return [ok, res.loq ? res.loq.c : null]
  }
  const need = r.n as number
  if (quick) return [ladder(m, s.metric, s.kTarget, 4, Math.min(need, MAX_LEVELS)).length >= need, null]
  const n = ladder(m, s.metric, s.kTarget, 4).length
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
    const scaled = (f: number): Curve => ({ mean: m.mean, cMax: m.cMax, sd: (c) => f * m.sd(c) })
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
