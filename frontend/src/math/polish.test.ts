import { describe, expect, it } from 'vitest'
import { whyNot } from './analysis'
import { measuredN, quantile, simulate } from './experiment'
import { mergeQuick, parseAnyBlock, parseQuick } from './table'

const lin = { mean: (c: number) => 100 + 10 * c, sd: () => 5, cMax: 100, levels: [0, 1, 2, 5, 10] }

describe('quick entry', () => {
  it('parses replicates, mean±sd, mean only', () => {
    expect(parseQuick('0:48,52,47  1:55±2.5 5:96 10:120+-4')).toEqual([
      { c: 0, ys: [48, 52, 47] },
      { c: 1, mean: 55, sd: 2.5 },
      { c: 5, mean: 96 },
      { c: 10, mean: 120, sd: 4 },
    ])
    expect(parseQuick('2=7,8')).toEqual([{ c: 2, ys: [7, 8] }])
  })
  it('rejects junk', () => {
    for (const t of ['', 'abc', '1:', '-1:5', '1:a,b', '1:5±-2', ':5']) expect(parseQuick(t), t).toBeNull()
  })
  it('merges: replaces an existing column, appends new ones, keeps 0 first', () => {
    const t = mergeQuick({ concs: [0, 5], cells: [[1, 2], [9, 9]], typed: [{ mean: null, sd: null }, { mean: null, sd: null }] }, [
      { c: 5, mean: 50, sd: 2 },
      { c: 1, ys: [3, 4] },
    ])
    const j5 = t.concs.indexOf(5)
    const j1 = t.concs.indexOf(1)
    expect(t.concs[0]).toBe(0)
    expect(t.cells[j5].filter((v) => v !== null)).toEqual([])
    expect(t.typed[j5]).toEqual({ mean: 50, sd: 2 })
    expect(t.cells[j1].filter((v) => v !== null)).toEqual([3, 4])
  })
})

describe('paste anywhere', () => {
  it('long c<TAB>signal rows become replicate columns', () => {
    const t = parseAnyBlock('0\t48\n0\t52\n1\t55\n1\t58\n5\t96')!
    expect(t.concs.filter((c) => c !== null)).toEqual([0, 1, 5])
    expect(t.cells[t.concs.indexOf(1)].filter((v) => v !== null)).toEqual([55, 58])
    expect(t.typed[t.concs.indexOf(5)].mean).toBe(96)
  })
  it('unlabelled c, mean, sd rows', () => {
    const t = parseAnyBlock('0,50,2\n5,95,3\n25,400,20')!
    expect(t.typed[t.concs.indexOf(25)]).toEqual({ mean: 400, sd: 20 })
  })
  it('quick text and labelled blocks; prose is not a table', () => {
    expect(parseAnyBlock('0:48,52 1:55,58')).not.toBeNull()
    expect(parseAnyBlock('c\t0\t1\n\t48\t55\n\t52\t58')).not.toBeNull()
    expect(parseAnyBlock('hello world')).toBeNull()
    expect(parseAnyBlock('5\t1')).toBeNull()
  })
})

describe('experiment engine', () => {
  it('quantile is numpy linear', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([10, 0, 5], 0.25)).toBe(2.5)
    expect(quantile([NaN, 3], 0.9)).toBe(3)
    expect(quantile([NaN], 0.5)).toBeNull()
  })
  it('is deterministic per seed and differs across seeds', () => {
    const a = simulate(lin, { n: 3, runs: 20, seed: 7, metric: 'dsum', k: 1 })
    const b = simulate(lin, { n: 3, runs: 20, seed: 7, metric: 'dsum', k: 1 })
    const c = simulate(lin, { n: 3, runs: 20, seed: 8, metric: 'dsum', k: 1 })
    expect(a).toEqual(b)
    expect(a.first.levels[0].ys).not.toEqual(c.first.levels[0].ys)
  })
  it('estimates centre on the truth over many runs; hist sums to runs', () => {
    const e = simulate(lin, { n: 8, runs: 2000, seed: 1, metric: 'dsum', k: 1 })
    e.levels.forEach((l) => expect(Math.abs((l.mean.med as number) - lin.mean(l.c))).toBeLessThan(0.5))
    expect(e.resolvedPairs.hist.reduce((s, x) => s + x, 0)).toBe(2000)
    expect(e.truth.resolvedPairs).toBe(4) // every adjacent pair has dsum ≥ 1 (0→1: Δμ 10 = 1·(5+5))
    expect(e.pairs.every((p) => p.pPass >= 0 && p.pPass <= 1)).toBe(true)
    expect(e.pairs[0].lo! <= e.pairs[0].med! && e.pairs[0].med! <= e.pairs[0].hi!).toBe(true)
  })
  it('validates like the backend', () => {
    expect(() => simulate(lin, { n: 1, metric: 'ssmd', k: 3 })).toThrow(/n must be/)
    expect(() => simulate(lin, { n: [3, 3], metric: 'ssmd', k: 3 })).toThrow(/must match/)
    expect(() => simulate(lin, { runs: 0, metric: 'ssmd', k: 3 })).toThrow(/runs/)
    expect(() => simulate(lin, { conf: 1, metric: 'ssmd', k: 3 })).toThrow(/conf/)
    expect(() => simulate(lin, { concs: [-1, 2], metric: 'ssmd', k: 3 })).toThrow(/concentrations/)
  })
  it('measuredN counts finite readings', () => {
    expect(measuredN([[1, null, 3], [], [NaN, 2]])).toEqual([2, 0, 1])
  })
})

describe('why not resolved', () => {
  it('linear, constant SD: closed forms', () => {
    const w = whyNot(lin, 0, 0.5, 'dsum', 1) // Δμ 5, needs 1·(5+5) = 10
    expect(w.needDmu).toBeCloseTo(10)
    expect(w.dmu).toBeCloseTo(5)
    expect(w.sdScale).toBeCloseTo(0.5)
    expect(w.moveTo).toBeCloseTo(1, 6)
    const s = whyNot(lin, 0, 0.5, 'ssmd', 3)
    expect(s.needDmu).toBeCloseTo(3 * Math.sqrt(50))
    const z = whyNot(lin, 0, 0.5, 'zprime', 0.5)
    expect(z.needDmu).toBeCloseTo(60)
    expect(z.sdScale).toBeCloseTo(0.5 / 6)
    expect(whyNot(lin, 0, 0.5, 'zprime', 1).needDmu).toBeNull()
  })
})

describe('unit ticks (resolvable units from an anchor)', () => {
  it('linear, constant SD: tick j at j target units', async () => {
    const { unitTicks } = await import('./analysis')
    // dsum k=1: units = (10Δc)/(5+5) = Δc → ticks at anchor + 1, 2, 3
    const t = unitTicks(lin, 2, 'dsum', 1, 100, 3)
    t.forEach((x, j) => expect(x).toBeCloseTo(2 + (j + 1), 6))
    // ssmd k=3: units = 10Δc/√50/3 → Δc = j·3√50/10
    unitTicks(lin, 0, 'ssmd', 3, 100, 2).forEach((x, j) => expect(x).toBeCloseTo(((j + 1) * 3 * Math.sqrt(50)) / 10, 6))
    // Z′ 0.5: unit = dsum 6 → Δc = 6j
    unitTicks(lin, 0, 'zprime', 0.5, 100, 2).forEach((x, j) => expect(x).toBeCloseTo(6 * (j + 1), 6))
    expect(unitTicks(lin, 0, 'zprime', 1, 100)).toEqual([])
    expect(unitTicks(lin, 98, 'dsum', 1, 100, 5)).toHaveLength(2) // only ticks within stop
  })
})

describe('local resolution (background colour)', () => {
  it('linear, constant SD: the resolvable step is exact', async () => {
    const { resolutionAt, resolutionQ } = await import('./analysis')
    // dsum k=1 on mean 100+10c, sd 5: one unit = Δc of 1 everywhere
    for (const c of [0, 2, 10]) expect(resolutionAt(lin, c, 'dsum', 1, 100)).toBeCloseTo(1, 4)
    expect(resolutionAt(lin, 0, 'dsum', 50, 3)).toBe(Infinity)
    expect(resolutionQ(1, 2, 0.1)).toBeCloseTo(1) // ±50% → the edge
    expect(resolutionQ(0.5, 2, 0.1)).toBeCloseTo(2) // ±25% → clear
    expect(resolutionQ(Infinity, 2, 0.1)).toBe(0)
    expect(resolutionQ(1, 0, 4)).toBeCloseTo(2) // c → 0 uses cRef
  })
})
