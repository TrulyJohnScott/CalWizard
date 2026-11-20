/**
 * Pass rule in plain words (spec section 12): every (metric, k) has one misclassification rate — the §5 err of a
 * pair with equal SDs sitting exactly on the threshold, Phi(-dsum). Port of backend/app/analysis.py rule_*.
 */
import { METRIC_LABEL } from './metrics'
import { normCdf, normQuantile } from './specials'
import type { MetricKey } from './types'

export function ruleError(metric: MetricKey, k: number): number {
  if (metric === 'zprime') return k >= 1 ? 0 : normCdf(-3 / (1 - k))
  if (k <= 0) return 0.5
  return normCdf(metric === 'dsum' ? -k : -k / Math.SQRT2)
}

/** Inverse of ruleError for 0 < error < 0.5; null outside. */
export function kForError(metric: MetricKey, error: number): number | null {
  if (!(error > 0 && error < 0.5)) return null
  const z = -normQuantile(error)
  return metric === 'dsum' ? z : metric === 'ssmd' ? Math.SQRT2 * z : 1 - 3 / z
}

/** "1.7%", "0.00034%", "< 0.0001%", "0%" (2 significant digits). */
export function pctText(e: number): string {
  if (e === 0) return '0%'
  if (e < 1e-6) return '< 0.0001%'
  return `${+(e * 100).toPrecision(2)}%`
}

export const kText = (k: number): string => String(+k.toPrecision(4))

/** "SSMD ≥ 3 · 1.7% misread" */
export function ruleText(metric: MetricKey, k: number): string {
  return `${METRIC_LABEL[metric]} ≥ ${kText(k)} · ${pctText(ruleError(metric, k))} misread`
}
