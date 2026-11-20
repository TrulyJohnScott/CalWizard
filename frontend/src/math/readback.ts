/**
 * Spec §18: the read-back sheet (signals → concentrations with a range, a CV and a flag). Port of backend readback.py.
 */
import { recover } from './analysis'
import { concCv, limits } from './limits'
import type { Model } from './model'
import type { LimitSettings, Sample } from './types'

export type Flag = 'ok' | 'invalid' | 'below' | 'above' | 'belowLod' | 'belowLoq' | 'aboveLoq'

export const FLAG_TEXT: Record<Flag, string> = {
  ok: '',
  invalid: 'no signal',
  below: 'below the blank',
  above: 'above the range',
  belowLod: 'not detected (< LoD)',
  belowLoq: 'detected, below LoQ',
  aboveLoq: 'above the quantifiable range',
}

export interface ReadRow {
  id: string
  signal: number | null
  dilution: number
  c: number | null
  lo: number | null
  hi: number | null
  result: number | null
  resultLo: number | null
  resultHi: number | null
  cv: number | null
  flag: Flag
}

export interface Readback {
  conf: number
  lod: number | null
  loq: number | null
  uloq: number | null
  rows: ReadRow[]
}

export function readback(m: Pick<Model, 'mean' | 'sd' | 'cMax'>, samples: Sample[], lim: LimitSettings, conf = 0.95): Readback {
  const res = limits(m, { ...lim, profile: false })
  const lod = res.lod ? res.lod.c : null
  const loq = res.loq ? res.loq.c : null
  const uloq = res.uloq ? res.uloq.c : null
  const d = res.direction
  const mu0 = res.blank.mean
  const rows = samples.map((x): ReadRow => {
    const dil = Number.isFinite(x.dilution) && x.dilution > 0 ? x.dilution : 1
    const row: ReadRow = { id: x.id, signal: x.signal, dilution: dil, c: null, lo: null, hi: null, result: null, resultLo: null, resultHi: null, cv: null, flag: 'invalid' }
    if (x.signal === null || !Number.isFinite(x.signal)) return row
    const r = recover(m, x.signal, conf)
    row.c = r.c
    row.lo = r.lo
    row.hi = r.hi
    if (r.c === null) {
      row.flag = d * (x.signal - mu0) < 0 ? 'below' : 'above'
      return row
    }
    row.result = r.c * dil
    row.cv = concCv(m, r.c, lim.reads)
    row.resultLo = r.lo === null ? null : r.lo * dil
    row.resultHi = r.hi === null ? null : r.hi * dil
    row.flag = lod !== null && r.c < lod ? 'belowLod' : loq !== null && r.c < loq ? 'belowLoq' : uloq !== null && r.c > uloq ? 'aboveLoq' : 'ok'
    return row
  })
  return { conf, lod, loq, uloq, rows }
}
