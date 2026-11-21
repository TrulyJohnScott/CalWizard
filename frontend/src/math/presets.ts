import { DEFAULT_LIMITS, type Series } from './types'

export interface Preset {
  label: string
  expr: string
}

export const MEAN_PRESETS: Preset[] = [
  { label: 'Linear', expr: '50 + 7*c' },
  { label: 'Quadratic', expr: '50 + 14*c - 0.012*c^2' },
  { label: 'Power', expr: '50 + 12*c^0.8' },
  { label: 'Exponential', expr: '50 + 20*(exp(0.008*c) - 1)' },
  { label: 'Log', expr: '50 + 900*ln(1 + c/20)' },
  { label: '4PL', expr: '4000 + (50 - 4000)/(1 + (c/40)^1.2)' },
  { label: '5PL', expr: '4000 + (50 - 4000)/(1 + (c/40)^1.2)^0.8' },
]

export const SD_PRESETS: Preset[] = [
  { label: 'Floor + CV', expr: 'sqrt(15^2 + (0.08*S)^2)' },
  { label: 'Constant', expr: '20' },
  { label: 'CV only', expr: '0.08*S' },
  { label: 'Power', expr: '2 + 0.05*S^1.1' },
]

export const DEFAULT_LEVELS = [0, 1, 5, 25, 100, 500]

export function defaultSeries(): Series {
  return {
    name: 'Example',
    analyte: '',
    units: 'ng/mL',
    signalLabel: 'Signal',
    mode: 'equations',
    meanExpr: MEAN_PRESETS[5].expr,
    sdExpr: SD_PRESETS[0].expr,
    levels: [...DEFAULT_LEVELS],
    extraLevels: [],
    cMax: 500,
    replicates: {
      concs: [0, 1, 5],
      cells: [
        [48.1, 52.0, 47.3],
        [55.0, 58.2, 53.9],
        [90.1, 101.3, 95.5],
      ],
    },
    summary: [
      { c: 0, mean: 50, sd: 15 },
      { c: 5, mean: 95, sd: 16 },
    ],
    metric: 'dsum',
    kTarget: 3,
    sim: { n: 5, seed: 42 },
    adjust: null,
    limits: { ...DEFAULT_LIMITS },
    requirements: [],
    samples: [],
    points: [],
    tolerance: { tea: 0.3, k: 2 },
    layers: [],
  }
}
