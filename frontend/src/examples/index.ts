/**
 * Example gallery (spec §21): complete Series a new user can start from. Each is plain Series JSON (the same shape the
 * CLI takes), kept here so the browser, the docs and the backend tests share one source.
 */
import type { Series } from '../math/types'

export interface Example {
  id: string
  title: string
  blurb: string
  series: Partial<Series>
}

const FLOOR_CV = 'sqrt(15^2 + (0.08*S)^2)'

export const EXAMPLES: Example[] = [
  {
    id: 'sandwich',
    title: 'Sandwich assay',
    blurb: 'Rising 4PL curve with a noise floor plus proportional CV. The usual starting point.',
    series: {
      name: 'Sandwich 4PL',
      analyte: 'CRP',
      units: 'ng/mL',
      signalLabel: 'Test line (a.u.)',
      mode: 'equations',
      meanExpr: '4000 + (50 - 4000)/(1 + (c/40)^1.2)',
      sdExpr: FLOOR_CV,
      levels: [0, 1, 5, 25, 100, 500],
      cMax: 500,
      requirements: [
        { kind: 'detect', c: 2 },
        { kind: 'distinguish', c: 5, c2: 10 },
        { kind: 'range', c: 2, c2: 60 },
      ],
    },
  },
  {
    id: 'competitive',
    title: 'Competitive assay',
    blurb: 'Signal falls as concentration rises. Limits and read-back follow the falling direction.',
    series: {
      name: 'Competitive',
      analyte: 'Cortisol',
      units: 'ng/mL',
      signalLabel: 'Test line (a.u.)',
      mode: 'equations',
      meanExpr: '150 + 3800/(1 + (c/30)^1.1)',
      sdExpr: 'sqrt(20^2 + (0.06*S)^2)',
      levels: [0, 3, 10, 30, 100, 300],
      cMax: 300,
      requirements: [{ kind: 'detect', c: 2 }, { kind: 'precision', c: 30, cv: 0.2 }],
    },
  },
  {
    id: 'reader',
    title: 'Reader data',
    blurb: 'Replicate readings as they come off a reader: eight blanks, five strips per level. Fits and limits come from the data.',
    series: {
      name: 'Lot 3 run',
      analyte: 'hs-cTnI',
      units: 'ng/L',
      signalLabel: 'T/C ratio',
      mode: 'replicates',
      replicates: {
        concs: [0, 5, 10, 25, 50, 100, 250],
        cells: [
          [0.021, 0.018, 0.025, 0.02, 0.016, 0.023, 0.019, 0.022],
          [0.041, 0.037, 0.046, 0.039, 0.043],
          [0.062, 0.058, 0.07, 0.064, 0.055],
          [0.128, 0.117, 0.139, 0.122, 0.131],
          [0.231, 0.214, 0.249, 0.226, 0.243],
          [0.418, 0.39, 0.447, 0.402, 0.431],
          [0.812, 0.77, 0.861, 0.79, 0.835],
        ],
      },
      metric: 'ssmd',
      kTarget: 3,
      samples: [
        { id: 'P-014', signal: 0.035, dilution: 1 },
        { id: 'P-015', signal: 0.152, dilution: 1 },
        { id: 'P-016', signal: 0.61, dilution: 1 },
        { id: 'P-017', signal: 0.019, dilution: 1 },
      ],
    },
  },
  {
    id: 'lowend',
    title: 'Low-end sensitivity',
    blurb: 'A near-linear low range where the blank noise decides everything. Good for LoB, LoD and LoQ work.',
    series: {
      name: 'Low range',
      analyte: 'PSA',
      units: 'pg/mL',
      signalLabel: 'T/C ratio',
      mode: 'equations',
      meanExpr: '0.02 + 0.011*c',
      sdExpr: 'sqrt(0.004^2 + (0.06*S)^2)',
      levels: [0, 1, 2, 5, 10, 25, 50],
      cMax: 50,
      requirements: [{ kind: 'detect', c: 1 }, { kind: 'range', c: 3, c2: 50 }],
    },
  },
  {
    id: 'semiquant',
    title: 'Semi-quantitative bins',
    blurb: 'A client asks for four reporting bins. The requirements view shows which cut-offs hold.',
    series: {
      name: 'hCG bins',
      analyte: 'hCG',
      units: 'mIU/mL',
      signalLabel: 'Test line (a.u.)',
      mode: 'equations',
      meanExpr: '3200 + (40 - 3200)/(1 + (c/400)^0.95)',
      sdExpr: 'sqrt(12^2 + (0.1*S)^2)',
      levels: [0, 25, 100, 500, 2000],
      cMax: 2000,
      requirements: [
        { kind: 'detect', c: 10, label: 'Negative below 10' },
        { kind: 'distinguish', c: 25, c2: 100, label: 'Low vs medium' },
        { kind: 'distinguish', c: 100, c2: 500, label: 'Medium vs high' },
        { kind: 'distinguish', c: 500, c2: 2000, label: 'High vs very high' },
        { kind: 'levels', n: 8 },
      ],
    },
  },
  {
    id: 'hook',
    title: 'High-dose hook',
    blurb: 'Signal rises, then drops at very high concentration. Shows where a reading stops being unambiguous.',
    series: {
      name: 'Hook effect',
      analyte: 'Ferritin',
      units: 'ng/mL',
      signalLabel: 'Test line (a.u.)',
      mode: 'equations',
      meanExpr: '50 + 4000*(c/60)^1.2/(1 + (c/60)^1.2)/(1 + (c/4000)^1.6)',
      sdExpr: FLOOR_CV,
      levels: [0, 10, 50, 250, 1000, 5000],
      cMax: 5000,
    },
  },
]
