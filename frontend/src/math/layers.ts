/**
 * Spec §22.2: variance budget and cumulative resolvable levels by layer. Port of backend/app/layers.py (budget,
 * cumulative); the design simulation and dial-in estimation run in the backend (/api/design, /api/dialin).
 */
import { ladder } from './analysis'
import { slope } from './limits'
import { compileModel, layerTerms, type Model } from './model'
import type { Series } from './types'

export interface BudgetRow {
  c: number
  mean: number
  total: number
  within: number
  withinShare: number | null
  layers: { name: string; on: boolean; var: number; share: number | null }[]
}

export function budget(s: Series, m: Model, concs?: number[]): BudgetRow[] {
  const layers = s.layers ?? []
  const mu0 = m.mean(0)
  const sw = m.sdWithin ?? m.sd
  return (concs ?? m.levels).map((c) => {
    const mean = m.mean(c)
    const { within, terms } = layerTerms(mean, sw(c), mu0, layers)
    const total = within + terms.reduce((a, t, i) => a + (layers[i].on ? t : 0), 0)
    return {
      c,
      mean,
      total,
      within,
      withinShare: total > 0 ? within / total : null,
      layers: layers.map((l, i) => ({ name: l.name, on: l.on, var: terms[i], share: l.on && total > 0 ? terms[i] / total : null })),
    }
  })
}

/** Headline ladder length with only the first k layers on, k = 0…L. */
export function cumulative(s: Series): { layers: string[]; n: number }[] {
  const layers = s.layers ?? []
  return Array.from({ length: layers.length + 1 }, (_, k) => {
    const names = layers.slice(0, k).map((l) => l.name)
    const m = compileModel({ ...s, layers: layers.map((l, i) => ({ ...l, on: i < k })) })
    return { layers: names, n: ladder(m, s.metric, s.kTarget, 4).length }
  })
}

export interface ToleranceSource {
  name: string
  /** fixed shift and SD in signal units */
  bias: number
  sd: number
  /** the same in concentration units (absent where the curve is flat) */
  biasC?: number
  sdC?: number
}

export interface ToleranceRow {
  c: number
  mean: number
  slope: number
  sources: ToleranceSource[]
  bias: number | null
  sd: number | null
  /** |Σ bias| + k·√Σ var */
  total: number | null
  /** Σ|bias| + k·Σ SD */
  worst: number | null
  rel: number | null
  worstRel: number | null
  ok: boolean | null
}

export interface Tolerance {
  k: number
  tea: number
  rows: ToleranceRow[]
  met: number
  total: number
}

/** Spec §24: the error budget per concentration as a tolerance stack. Port of backend layers.tolerance. */
export function tolerance(s: Series, m: Model, concs?: number[], k = s.tolerance.k, tea = s.tolerance.tea): Tolerance {
  if (!(Number.isFinite(k) && k > 0 && Number.isFinite(tea) && tea > 0)) throw new Error('k and tea must be > 0')
  const on = (s.layers ?? []).filter((l) => l.on)
  const mu0 = m.mean(0)
  const sw = m.sdWithin ?? m.sd
  const rows = (concs ?? m.levels).map((c): ToleranceRow => {
    const mean = m.mean(c)
    const { within, terms } = layerTerms(mean, sw(c), mu0, on)
    const sl = slope(m, c)
    const sources: ToleranceSource[] = [{ name: 'within run', bias: 0, sd: Math.sqrt(within) }, ...on.map((l, i) => ({ name: l.name, bias: l.biasOffset + l.biasPct * mean, sd: Math.sqrt(terms[i]) }))]
    const row: ToleranceRow = { c, mean, slope: sl, sources, bias: null, sd: null, total: null, worst: null, rel: null, worstRel: null, ok: null }
    if (sl !== 0 && Number.isFinite(sl)) {
      for (const x of sources) {
        x.biasC = x.bias / sl
        x.sdC = x.sd / Math.abs(sl)
      }
      row.bias = sources.reduce((a, x) => a + (x.biasC as number), 0)
      row.sd = Math.sqrt(sources.reduce((a, x) => a + (x.sdC as number) ** 2, 0))
      row.total = Math.abs(row.bias) + k * row.sd
      row.worst = sources.reduce((a, x) => a + Math.abs(x.biasC as number), 0) + k * sources.reduce((a, x) => a + (x.sdC as number), 0)
      if (c > 0) {
        row.rel = row.total / c
        row.worstRel = row.worst / c
        row.ok = row.rel <= tea
      }
    }
    return row
  })
  const judged = rows.filter((r) => r.ok !== null)
  return { k, tea, rows, met: judged.filter((r) => r.ok).length, total: judged.length }
}
