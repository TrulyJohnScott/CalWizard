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

/** Spec section 4. */
export interface Series {
  name: string
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
  /** variability layers on top of the within-run curve (spec §16) */
  layers: Layer[]
}

/** A source of variability (spec §16): per-unit offset SD, proportional CV, gain CV ("performance"), noise CV. */
export interface Layer {
  name: string
  units: number
  on: boolean
  offsetSd: number
  cv: number
  gainCv: number
  noiseCv: number
}
