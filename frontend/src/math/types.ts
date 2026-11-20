export type Mode = 'equations' | 'replicates' | 'summary'
export type MetricKey = 'dsum' | 'ssmd' | 'zprime'

export interface SummaryRow {
  c: number | null
  mean: number | null
  sd: number | null
}

export interface Replicates {
  /** column headers; the first is fixed at 0 in the UI */
  concs: (number | null)[]
  /** cells[j] = replicate signals of column j (ragged allowed, null = empty) */
  cells: (number | null)[][]
}

/** What-if layer on top of the curve (spec §14). null / 1 = unchanged. */
export interface Adjust {
  /** signal at c = 0 (null = as is) */
  bottom: number | null
  /** signal the unadjusted top (at cMax) maps to (null = as is) */
  top: number | null
  /** stretch of the concentration axis: mean'(c) = f(c / cScale) */
  cScale: number
  /** every SD is multiplied by this */
  sdScale: number
}

/** Detection-limit settings (spec §15). */
export interface LimitSettings {
  alpha: number
  beta: number
  /** concentration CV allowed at the LoQ, as a fraction */
  cv: number
  /** readings averaged per result */
  reads: number
}

export type RequirementKind = 'detect' | 'distinguish' | 'precision' | 'range' | 'levels'

/** One client requirement (spec §17). */
export interface Requirement {
  kind: RequirementKind
  c?: number | null
  c2?: number | null
  cv?: number | null
  n?: number | null
  label?: string
}

/** One row of the read-back sheet (spec §18). */
export interface Sample {
  id: string
  signal: number | null
  dilution: number
}

/** Spec section 4. */
export interface Series {
  name: string
  analyte: string
  units: string
  signalLabel: string
  mode: Mode
  meanExpr: string
  sdExpr: string
  levels: number[]
  cMax: number
  /** simulated concentrations added in table modes (spec §4, v2.4) */
  extraLevels: number[]
  replicates: Replicates
  summary: SummaryRow[]
  metric: MetricKey
  kTarget: number
  sim: { n: number; seed: number }
  adjust: Adjust | null
  limits: LimitSettings
  requirements: Requirement[]
  samples: Sample[]
}

export const NO_ADJUST: Adjust = { bottom: null, top: null, cScale: 1, sdScale: 1 }
export const DEFAULT_LIMITS: LimitSettings = { alpha: 0.05, beta: 0.05, cv: 0.2, reads: 1 }

export const adjustActive = (a: Adjust | null | undefined): a is Adjust => !!a && (a.bottom !== null || a.top !== null || a.cScale !== 1 || a.sdScale !== 1)
