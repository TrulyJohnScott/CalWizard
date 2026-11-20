import { describe, expect, it } from 'vitest'
import { pairRow } from './analysis'
import { closenessColor, closenessQ } from './closeness'

describe('closenessColor', () => {
  it('deep red at or below 0.25, orange at 0.6, yellow just below 1', () => {
    expect(closenessColor(0).slice(0, 3)).toEqual([196, 32, 45])
    expect(closenessColor(0.25).slice(0, 3)).toEqual([196, 32, 45])
    expect(closenessColor(0.6).slice(0, 3)).toEqual([240, 128, 40])
    const y = closenessColor(0.9999)
    expect(y[0]).toBeGreaterThan(240)
    expect(y[1]).toBeGreaterThan(190)
    expect(y[3]).toBeGreaterThan(0.5)
  })
  it('blue at q = 1 fading to clear by 2', () => {
    const b = closenessColor(1)
    expect(b.slice(0, 3)).toEqual([64, 132, 205])
    expect(b[3]).toBeCloseTo(0.5, 9)
    expect(closenessColor(1.5)[3]).toBeCloseTo(0.25, 9)
    expect(closenessColor(2)[3]).toBe(0)
    expect(closenessColor(10)[3]).toBe(0)
    expect(closenessColor(Infinity)[3]).toBe(0)
  })
  it('bad input is treated as hot', () => {
    expect(closenessColor(NaN).slice(0, 3)).toEqual([196, 32, 45])
    expect(closenessColor(-1)[3]).toBeGreaterThan(0)
  })
  it('red-to-yellow is continuous and monotone in green', () => {
    let g = -1
    for (let q = 0; q < 1; q += 0.01) {
      const c = closenessColor(q)
      expect(c[1]).toBeGreaterThanOrEqual(g)
      g = c[1]
    }
  })
})

describe('closenessQ', () => {
  const m = { mean: (c: number) => 100 + 10 * c, sd: () => 5 }
  it('dsum / ssmd: |value| / k', () => {
    const r = pairRow(m, 0, 1, 'dsum', 1)
    expect(closenessQ(r, 'dsum', 1)).toBeCloseTo(1, 12)
    expect(closenessQ(r, 'dsum', 2)).toBeCloseTo(0.5, 12)
    const s = pairRow(m, 0, 3, 'ssmd', 3)
    expect(closenessQ(s, 'ssmd', 3)).toBeCloseTo(s.ssmd / 3, 12)
  })
  it("Z': q = 1 exactly when Z' = k", () => {
    // choose dc so that zprime = 0.5: dmu/(sd1+sd2) = 3/(1-0.5) = 6 -> dc = 6
    const r = pairRow(m, 0, 6, 'zprime', 0.5)
    expect(r.zprime).toBeCloseTo(0.5, 12)
    expect(closenessQ(r, 'zprime', 0.5)).toBeCloseTo(1, 12)
    expect(closenessQ(pairRow(m, 0, 3, 'zprime', 0.5), 'zprime', 0.5)).toBeCloseTo(0.5, 12)
  })
  it('NaN -> 0', () => {
    expect(closenessQ({ dsum: NaN, ssmd: NaN, zprime: NaN }, 'ssmd', 3)).toBe(0)
  })
})

describe('smooth background ramp', () => {
  it('is continuous through the pass line (no jump at q = 1)', async () => {
    const { closenessRgbSmooth } = await import('./closeness')
    const d = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
    for (const q of [0.25, 0.6, 1, 1.5, 2]) expect(d(closenessRgbSmooth(q - 1e-6), closenessRgbSmooth(q + 1e-6))).toBeLessThanOrEqual(1)
    expect(closenessRgbSmooth(0)).toEqual([196, 32, 45])
    expect(closenessRgbSmooth(5)).toEqual([64, 132, 205])
  })
})
