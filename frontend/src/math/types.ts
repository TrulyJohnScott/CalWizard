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
  /** the noise split in two (core design): floor = the SD at the blank, CV part = the rest; each scaled on its own */
  floorScale?: number
  cvScale?: number
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
  /** the value is the mean of this many strips (core design) */
  strips?: number
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
  /** the concentrations being evaluated (core design): separate from the calibration data; `strips` per point
   *  (null = the default, limits.reads). 0 is always the first point and is not stored. */
  points: { c: number; strips: number | null }[]
  /** the curve chosen from the data (core design): it defines the mean in Data and Stats; null = smooth interpolation */
  dataFit?: { meanExpr: string; label: string; kind: string } | null
  /** error budget settings (spec §24): allowed total error as a fraction of c, coverage factor on the spread */
  tolerance: { tea: number; k: number }
  /** variability layers on top of the within-run curve (spec §22) */
  layers: Layer[]
}

/** A source of variability (spec §22): per-unit offset SD, proportional CV, gain CV ("performance"), noise CV. */
export interface Layer {
  name: string
  units: number
  on: boolean
  offsetSd: number
  cv: number
  gainCv: number
  noiseCv: number
  /** a known fixed shift against the calibration (spec §24): signal units, and a fraction of the signal */
  biasOffset: number
  biasPct: number
}

export const NO_ADJUST: Adjust = { bottom: null, top: null, cScale: 1, sdScale: 1, floorScale: 1, cvScale: 1 }
export const DEFAULT_LIMITS: LimitSettings = { alpha: 0.05, beta: 0.05, cv: 0.2, reads: 1 }

export const adjustActive = (a: Adjust | null | undefined): a is Adjust => !!a && (a.bottom !== null || a.top !== null || a.cScale !== 1 || a.sdScale !== 1 || (a.floorScale ?? 1) !== 1 || (a.cvScale ?? 1) !== 1)
