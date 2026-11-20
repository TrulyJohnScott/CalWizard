import { describe, expect, it } from 'vitest'
import { compileModel } from '../math/model'
import { defaultSeries } from '../math/presets'
import type { Series } from '../math/types'
import { fitBody } from './FitPanel'

const series = (p: Partial<Series>): Series => ({ ...defaultSeries(), ...p })

describe('what the live fit sends', () => {
  it('replicates → raw points', () => {
    const s = series({ mode: 'replicates', replicates: { concs: [0, 1], cells: [[48, 52], [55, null, 58]] } })
    expect(fitBody(s, compileModel(s))).toEqual({ points: [{ c: 0, y: 48 }, { c: 0, y: 52 }, { c: 1, y: 55 }, { c: 1, y: 58 }] })
  })
  it('summary → mean/sd rows', () => {
    const s = series({ mode: 'summary', summary: [{ c: 0, mean: 50, sd: 2 }, { c: 5, mean: 95, sd: 4 }] })
    expect(fitBody(s, compileModel(s))).toEqual({ summary: [{ c: 0, mean: 50, sd: 2 }, { c: 5, mean: 95, sd: 4 }] })
  })
  it('mixed table (typed mean/sd in a column without readings) → per-level summary', () => {
    const s = series({ mode: 'replicates', replicates: { concs: [0, 5], cells: [[48, 52], []] }, summary: [{ c: 5, mean: 95, sd: 4 }] })
    const b = fitBody(s, compileModel(s)) as { summary: { c: number; mean: number }[] }
    expect(b.summary.map((r) => r.c)).toEqual([0, 5])
    expect(b.summary[1].mean).toBe(95)
  })
})
