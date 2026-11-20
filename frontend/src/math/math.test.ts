import { describe, expect, it } from 'vitest'
import { inverse, ladder, pairRow } from './analysis'
import { compileExpr, parseExpr } from './expr'
import { makeInterp } from './interp'
import { compileModel } from './model'
import { defaultSeries } from './presets'
import { fromTable, normTable, pasteWhole, setTableCell, tableFromEquations, toTable } from './table'
import { parseLevels, parseReplicatesBlock, parseSummaryBlock, replicateStats } from './tables'

const ev = (src: string, x = 0, v: 'c' | 'S' = 'c') => {
  const r = compileExpr(src, v)
  if (!r.ok) throw new Error(r.error)
  return r.fn(x)
}

describe('expression parser', () => {
  it('precedence and associativity', () => {
    expect(ev('1 + 2*3')).toBe(7)
    expect(ev('(1 + 2)*3')).toBe(9)
    expect(ev('-2^2')).toBe(-4)
    expect(ev('2^3^2')).toBe(512)
    expect(ev('2^-1')).toBe(0.5)
    expect(ev('8/4/2')).toBe(1)
    expect(ev('10 - 3 - 2')).toBe(5)
    expect(ev('--3')).toBe(3)
  })
  it('numbers', () => {
    expect(ev('.5 + 1e2 + 2.5E-1')).toBeCloseTo(100.75, 12)
  })
  it('functions: log is base 10, ln natural, case-insensitive', () => {
    expect(ev('log(1000)')).toBeCloseTo(3, 12)
    expect(ev('LOG10(100)')).toBeCloseTo(2, 12)
    expect(ev('ln(exp(2))')).toBeCloseTo(2, 12)
    expect(ev('Sqrt(16) + abs(-2) + min(3, 1, 2) + max(1, 5)')).toBe(12)
    expect(ev('pi')).toBeCloseTo(Math.PI, 12)
  })
  it('variables: c for mean, S or s for sd', () => {
    expect(ev('2*c', 4)).toBe(8)
    expect(ev('2*S', 4, 'S')).toBe(8)
    expect(ev('2*s', 4, 'S')).toBe(8)
  })
  it('NaN / inf propagate', () => {
    expect(Number.isNaN(ev('sqrt(-1)'))).toBe(true)
    expect(ev('1/0')).toBe(Infinity)
  })
  it('errors carry positions', () => {
    const pos = (src: string, v: 'c' | 'S' = 'c') => {
      const r = compileExpr(src, v)
      return r.ok ? -1 : r.pos
    }
    expect(pos('')).toBe(0)
    expect(pos('1 +')).toBe(3)
    expect(pos('1 + x')).toBe(4)
    expect(pos('S + 1')).toBe(0)
    expect(pos('c + 1', 'S')).toBe(0)
    expect(pos('(1 + 2')).toBe(6)
    expect(pos('1 2')).toBe(2)
    expect(pos('foo(1)')).toBe(0)
    expect(pos('1 $ 2')).toBe(2)
    expect(pos('sqrt(1, 2)')).toBe(0)
    expect(() => parseExpr('1 +', 'c')).toThrow()
  })
})

describe('table interpolation', () => {
  it('constant, linear, clamp', () => {
    expect(makeInterp([[1, 7]])(100)).toBe(7)
    const f = makeInterp([[0, 0], [10, 20]])
    expect(f(5)).toBeCloseTo(10, 12)
    expect(f(-3)).toBe(0)
    expect(f(99)).toBe(20)
  })
  it('PCHIP is monotone and passes through knots; duplicates averaged', () => {
    const f = makeInterp([[0, 0], [1, 1], [2, 10], [3, 11]])
    expect(f(1)).toBeCloseTo(1, 12)
    let prev = -Infinity
    for (let c = 0; c <= 3; c += 0.05) {
      const v = f(c)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = v
    }
    const g = makeInterp([[0, 1], [0, 3], [4, 2]])
    expect(g(0)).toBe(2)
  })
  it('replicate columns: sample SD, <2 values excluded from SD', () => {
    const s = defaultSeries()
    s.mode = 'replicates'
    s.replicates = { concs: [0, 1, 5], cells: [[1, 2, 3], [10], [20, 22, null]] }
    const st = replicateStats(s.replicates)
    expect(st[0].sd).toBeCloseTo(1, 12)
    expect(st[1].sd).toBeNull()
    const m = compileModel(s)
    expect(m.sd(0)).toBeCloseTo(1, 12)
    expect(m.sd(1)).toBeGreaterThan(0.99)
    expect(m.sd(1)).toBeLessThan(1.42)
    expect(m.sd(5)).toBeCloseTo(Math.SQRT2, 12)
    expect(m.mean(1)).toBe(10)
    expect(m.levels).toEqual([0, 1, 5])
  })
  it('no SD anywhere gives sd = 0', () => {
    const s = defaultSeries()
    s.mode = 'summary'
    s.summary = [{ c: 0, mean: 1, sd: null }, { c: 2, mean: 3, sd: null }]
    const m = compileModel(s)
    expect(m.noSd).toBe(true)
    expect(m.sd(1)).toBe(0)
  })
})

describe('paste parsing', () => {
  it('replicates: first row is concentrations', () => {
    const r = parseReplicatesBlock('0\t1\t5\n48.1\t55\t90\n52\t58.2\t101.3\r\n47.3\t\t95.5\n')
    expect(r!.concs).toEqual([0, 1, 5])
    expect(r!.cells[0]).toEqual([48.1, 52, 47.3])
    expect(r!.cells[1]).toEqual([55, 58.2])
    expect(r!.cells[2]).toEqual([90, 101.3, 95.5])
  })
  it('replicates: leading label cell dropped', () => {
    const r = parseReplicatesBlock('c\t0\t10\nr1\t1\t2\nr2\t3\t4')
    expect(r!.concs).toEqual([0, 10])
    expect(r!.cells).toEqual([[1, 3], [2, 4]])
  })
  it('summary: c / mean / sd rows, with or without header', () => {
    expect(parseSummaryBlock('0\t50\t15\n5\t95\t16')).toEqual([
      { c: 0, mean: 50, sd: 15 },
      { c: 5, mean: 95, sd: 16 },
    ])
    expect(parseSummaryBlock('c\tmean\tsd\n0\t50\t15')!.length).toBe(1)
  })
  it('summary: transposed with row labels', () => {
    expect(parseSummaryBlock('c\t0\t5\nmean\t50\t95\nsd\t15\t16')).toEqual([
      { c: 0, mean: 50, sd: 15 },
      { c: 5, mean: 95, sd: 16 },
    ])
  })
  it('levels field forces 0, sorts, dedups', () => {
    expect(parseLevels('25, 5 1,1 100')).toEqual([0, 1, 5, 25, 100])
    expect(parseLevels('1, x')).toBeNull()
    expect(parseLevels('-1')).toBeNull()
  })
})

describe('inverse', () => {
  const m = compileModel(defaultSeries())
  it('round-trips mean(c)', () => {
    for (const c of [0, 3, 40, 250, 499]) {
      const back = inverse(m, m.mean(c))
      expect(back).not.toBeNull()
      expect(Math.abs((back as number) - c)).toBeLessThan(1e-6 * Math.max(1, c))
    }
  })
  it('null outside range', () => {
    expect(inverse(m, 5000)).toBeNull()
    expect(inverse(m, -100)).toBeNull()
  })
})

describe('ladder', () => {
  const lin = { mean: (c: number) => 100 + 10 * c, sd: () => 5, cMax: 100 }
  it('dsum k=1 on constant sd: steps of sigma_a + sigma_b', () => {
    const l = ladder(lin, 'dsum', 1)
    // dmu = 10*dc = 10 -> dc = 1
    expect(l[0]).toBe(0)
    expect(l[1]).toBeCloseTo(1, 9)
    expect(l[2]).toBeCloseTo(2, 9)
    expect(l.length).toBe(101)
  })
  it('every consecutive pair passes and the gap is minimal', () => {
    const m = compileModel(defaultSeries())
    const l = ladder(m, 'ssmd', 3)
    expect(l.length).toBeGreaterThan(2)
    for (let i = 0; i + 1 < l.length; i++) {
      expect(pairRow(m, l[i], l[i + 1], 'ssmd', 3).pass).toBe(true)
      expect(pairRow(m, l[i], l[i + 1] - 1e-6 * Math.max(1, l[i + 1]), 'ssmd', 3).pass).toBe(false)
      expect(l[i + 1]).toBeGreaterThan(l[i])
    }
    expect(l[l.length - 1]).toBeLessThanOrEqual(m.cMax)
  })
  it('from/to: ladder between two concentrations', () => {
    const l = ladder({ ...lin, cMax: 10 }, 'dsum', 1, 0, 200, 4)
    expect(l[0]).toBe(4)
    expect(l.length).toBe(7) // 4,5,...,10
  })
  it('stops when nothing passes', () => {
    expect(ladder({ mean: () => 1, sd: () => 1, cMax: 10 }, 'ssmd', 3)).toEqual([0])
  })
  it('Z-prime metric', () => {
    const l = ladder(lin, 'zprime', 0.5)
    expect(l.length).toBeGreaterThan(2)
    expect(pairRow(lin, l[0], l[1], 'zprime', 0.5).zprime).toBeCloseTo(0.5, 6)
  })
})

describe('unified table', () => {
  const base = defaultSeries()
  it('replicates + typed mean/sd columns', () => {
    let t = toTable({ ...base, mode: 'replicates', replicates: { concs: [0, 1], cells: [[1, 3], [10, 12]] }, summary: [] })
    t = setTableCell(t, { kind: 'conc', j: 2 }, 5) // grows a column
    t = setTableCell(t, { kind: 'mean', j: 2 }, 100)
    t = setTableCell(t, { kind: 'sd', j: 2 }, 7)
    t = setTableCell(t, { kind: 'mean', j: 0 }, 999) // column has replicates: ignored
    const f = fromTable(t)
    expect(f.mode).toBe('replicates')
    expect(f.replicates.concs).toEqual([0, 1, 5])
    expect(f.summary).toContainEqual({ c: 5, mean: 100, sd: 7 })
    const m = compileModel({ ...base, ...f })
    expect(m.mean(5)).toBe(100)
    expect(m.sd(5)).toBe(7)
    expect(m.mean(0)).toBe(2)
    expect(m.levels).toEqual([0, 1, 5])
  })
  it('no replicates at all -> summary mode', () => {
    let t = toTable({ ...base, mode: 'summary', summary: [{ c: 0, mean: 50, sd: 15 }] })
    t = setTableCell(t, { kind: 'conc', j: 1 }, 5)
    t = setTableCell(t, { kind: 'mean', j: 1 }, 95)
    const f = fromTable(t)
    expect(f.mode).toBe('summary')
    expect(f.summary).toEqual([{ c: 0, mean: 50, sd: 15 }, { c: 5, mean: 95, sd: null }])
  })
  it('column 0 conc is fixed; trailing empties are trimmed', () => {
    let t = toTable({ ...base, mode: 'replicates' })
    t = setTableCell(t, { kind: 'conc', j: 0 }, 9)
    expect(t.concs[0]).toBe(0)
    t = setTableCell(t, { kind: 'rep', j: 6, i: 0 }, 1)
    t = setTableCell(t, { kind: 'rep', j: 6, i: 0 }, null)
    expect(normTable(t).concs.length).toBe(3)
  })
  it('equations -> table, with and without simulated replicates', () => {
    const s = defaultSeries()
    const m = compileModel(s)
    const typed = tableFromEquations(s, m, 0)
    expect(typed.concs).toEqual([0, 1, 5, 25, 100, 500])
    expect(typed.typed[0].mean).toBeCloseTo(50, 3)
    const sim = tableFromEquations(s, m, 4)
    expect(sim.cells.every((c) => c.length === 4)).toBe(true)
    expect(fromTable(sim).mode).toBe('replicates')
    expect(fromTable(typed).mode).toBe('summary')
  })
  it('labelled whole-table paste', () => {
    const t = pasteWhole('c\t0\t5\nmean\t50\t95\nsd\t15\t16')!
    expect(t.concs).toEqual([0, 5])
    expect(t.typed[1]).toEqual({ mean: 95, sd: 16 })
    expect(pasteWhole('1\t2\n3\t4')).toBeNull()
  })
})
