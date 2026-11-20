/**
 * Spec §16.2: variance budget and cumulative resolvable levels by layer. Port of backend/app/layers.py (budget,
 * cumulative); the design simulation and dial-in estimation run in the backend (/api/design, /api/dialin).
 */
import { ladder } from './analysis'
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
