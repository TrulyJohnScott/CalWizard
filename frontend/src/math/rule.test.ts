import { describe, expect, it } from 'vitest'
import { pairRow } from './analysis'
import { kForError, pctText, ruleError, ruleText } from './rule'
import { normCdf, normQuantile } from './specials'

describe('normQuantile', () => {
  it('inverts normCdf across the range', () => {
    for (const p of [1e-15, 1e-12, 1e-9, 1e-6, 1e-3, 0.0135, 0.02425, 0.1, 0.3, 0.5, 0.7, 0.97575, 0.999, 1 - 1e-9]) {
      const x = normQuantile(p)
      expect(normCdf(x) / p, `p=${p}`).toBeCloseTo(1, 9)
    }
  })
  it('known values and edges', () => {
    expect(normQuantile(0.975)).toBeCloseTo(1.959963984540054, 12)
    expect(normQuantile(0.5)).toBe(0)
    expect(normQuantile(0)).toBe(-Infinity)
    expect(normQuantile(1)).toBe(Infinity)
    expect(normQuantile(1.5)).toBeNaN()
  })
})

describe('pass rule', () => {
  it('matches the §5 err of an equal-SD pair on the threshold', () => {
    const sd = 7
    for (const [metric, k, dmu] of [['dsum', 1.3, 1.3 * 2 * sd], ['ssmd', 2.4, 2.4 * Math.SQRT2 * sd], ['zprime', 0.2, (6 * sd) / 0.8]] as const) {
      const row = pairRow({ mean: (c) => 100 + c * dmu, sd: () => sd }, 0, 1, metric, k)
      expect(row.err / ruleError(metric, k)).toBeCloseTo(1, 6)
    }
  })
  it('edges', () => {
    expect(ruleError('ssmd', 0)).toBe(0.5)
    expect(ruleError('dsum', -2)).toBe(0.5)
    expect(ruleError('zprime', 1)).toBe(0)
    expect(kForError('ssmd', 0)).toBeNull()
    expect(kForError('ssmd', 0.5)).toBeNull()
    expect(kForError('ssmd', NaN)).toBeNull()
  })
  it('round-trips', () => {
    for (const m of ['dsum', 'ssmd', 'zprime'] as const)
      for (const e of [1e-10, 1e-4, 0.01, 0.2, 0.45]) expect(ruleError(m, kForError(m, e)!) / e).toBeCloseTo(1, 8)
  })
  it('text matches the backend wording', () => {
    expect(ruleText('ssmd', 3)).toBe('SSMD ≥ 3 · 1.7% misread')
    expect(ruleText('dsum', 1)).toBe('Δμ/Σσ ≥ 1 · 16% misread')
    expect(ruleText('zprime', 0.5)).toBe('Z′ ≥ 0.5 · < 0.0001% misread')
    expect(ruleText('zprime', 1)).toBe('Z′ ≥ 1 · 0% misread')
    expect(ruleText('ssmd', 2.12132034)).toBe('SSMD ≥ 2.121 · 6.7% misread')
    expect(ruleText('dsum', 4.5)).toBe('Δμ/Σσ ≥ 4.5 · 0.00034% misread')
    expect(pctText(0.01)).toBe('1%')
  })
})
