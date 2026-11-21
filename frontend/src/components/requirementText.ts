/**
 * Requirements as plain sentences (spec §17), for the report: what is asked, what was found and the gap.
 * Requirements are set headless (Series JSON, CLI, API); the GUI shows them in the report when a series has any.
 */
import { fmt, pct2, withUnits } from '../format'
import { METRIC_LABEL } from '../math/metrics'
import type { RequirementResult } from '../math/requirements'
import { kText } from '../math/rule'
import type { Requirement, Series } from '../math/types'

/** The requirement as a plain sentence (report, tooltips). */
export function requirementText(r: Requirement, s: Pick<Series, 'units' | 'limits'>): string {
  const u = s.units
  switch (r.kind) {
    case 'detect':
      return `Detect ${withUnits(r.c, u)}`
    case 'distinguish':
      return `Tell ${fmt(r.c)} from ${withUnits(r.c2, u)}`
    case 'precision':
      return `Measure ${withUnits(r.c, u)} within ${fmt((r.cv ?? 0) * 100, 3)}% CV`
    case 'range':
      return `Quantify from ${fmt(r.c)} to ${withUnits(r.c2, u)} within ${fmt((r.cv ?? s.limits.cv) * 100, 3)}% CV`
    case 'levels':
      return `Resolve at least ${r.n ?? '?'} levels`
  }
}

/** What was measured, and the gap when it is not met. */
export function requirementFinding(r: RequirementResult, s: Pick<Series, 'units' | 'metric' | 'kTarget'>): { found: string; gap: string | null } {
  if (r.error) return { found: 'fill in the numbers', gap: null }
  const u = s.units
  const found =
    r.kind === 'detect'
      ? r.value === null ? 'no detection limit in this range' : `LoD is ${withUnits(r.value, u)}`
      : r.kind === 'distinguish'
        ? `${METRIC_LABEL[s.metric]} ${fmt(r.value)} (needs ${kText(s.kTarget)})`
        : r.kind === 'precision'
          ? `CV there is ${pct2(r.value)}`
          : r.kind === 'range'
            ? r.value === null ? 'not quantifiable across it (flat curve or past the hook)' : `worst CV across it ${pct2(r.value)}`
            : `${fmt(r.value)} resolvable levels`
  const gap = r.ok ? null : r.sdScale === null ? 'tighter noise alone will not get there' : `met if the noise were ${fmt(r.sdScale, 2)}× of today`
  return { found, gap }
}
