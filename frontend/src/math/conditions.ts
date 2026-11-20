/**
 * Spec §23: conditions. Several curves of the same assay (lots, readers, days, sites) compared against a reference,
 * and the spread between them sized as one variability layer. Port of backend/app/conditions.py.
 */
import { inverse, ladder } from './analysis'
import { limits } from './limits'
import type { Model } from './model'
import type { Series } from './types'

export interface Comparison {
  reference: string
  conditions: { name: string; levels: number; lod: number | null; loq: number | null }[]
  rows: {
    c: number
    mean: number[]
    /** (mean − reference mean) / reference mean */
    bias: (number | null)[]
    /** the concentration the reference curve reports for this condition's signal */
    readsAs: (number | null)[]
    /** (readsAs − c) / c */
    concBias: (number | null)[]
  }[]
  between: { units: number; offsetSd: number; gainCv: number } | null
}

const sd = (v: number[]) => {
  if (v.length < 2) return 0
  const m = v.reduce((a, b) => a + b, 0) / v.length
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1))
}
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b)
  const h = Math.floor(s.length / 2)
  return s.length % 2 ? s[h] : 0.5 * (s[h - 1] + s[h])
}

/** `items[0]` is the reference. */
export function compare(items: { series: Series; model: Model }[], concs?: number[]): Comparison {
  if (!items.length) throw new Error('compare needs at least one series')
  const ref = items[0].model
  const cs = concs ?? ref.levels
  const conditions = items.map(({ series: s, model: m }) => {
    const lim = limits(m, { ...s.limits, profile: false })
    return { name: s.name, levels: ladder(m, s.metric, s.kTarget, 4).length, lod: lim.lod ? lim.lod.c : null, loq: lim.loq ? lim.loq.c : null }
  })
  const rows = cs.map((c) => {
    const mean = items.map((x) => x.model.mean(c))
    const readsAs = mean.map((mu) => inverse(ref, mu))
    return {
      c,
      mean,
      bias: mean.map((mu) => (mean[0] !== 0 ? (mu - mean[0]) / mean[0] : null)),
      readsAs,
      concBias: readsAs.map((b) => (b === null || c === 0 ? null : (b - c) / c)),
    }
  })
  let between: Comparison['between'] = null
  if (items.length > 1) {
    const blanks = items.map((x) => x.model.mean(0))
    const ratios: number[] = []
    for (const c of cs) {
      if (c <= 0) continue
      const rise = items.map((x, i) => x.model.mean(c) - blanks[i])
      const avg = rise.reduce((a, b) => a + b, 0) / rise.length
      if (avg !== 0) ratios.push(sd(rise) / Math.abs(avg))
    }
    between = { units: items.length, offsetSd: sd(blanks), gainCv: ratios.length ? median(ratios) : 0 }
  }
  return { reference: items[0].series.name, conditions, rows, between }
}
