/** Browser-only logic of the workspaces (spec §14, §18, §21). Parity with the backend lives in math/parity.test.ts. */
import { describe, expect, it } from 'vitest'
import { pasteBlock } from './components/ReadWorkspace'
import { EXAMPLES } from './examples'
import { limits } from './math/limits'
import { compileModel } from './math/model'
import { defaultSeries } from './math/presets'
import type { Series } from './math/types'
import { dragHandle, handles } from './math/whatif'
import { decodeShare, encodeShare, reportDocument, seriesFromReport, shareFromHash } from './share'
import { sanitizeSeries } from './state/store'

const line = (): Series => ({ ...defaultSeries(), meanExpr: '100 + 20*c', sdExpr: '10', levels: [0, 10, 50], cMax: 100 })

describe('what-if handles', () => {
  it('dragging a handle puts the curve under the cursor', () => {
    const s = line()
    const m = compileModel(s)
    const top = compileModel({ ...s, adjust: dragHandle(null, m, 'top', 100, 3000)! })
    expect(top.mean(100)).toBeCloseTo(3000, 6)
    const bottom = compileModel({ ...s, adjust: dragHandle(null, m, 'bottom', 0, 40)! })
    expect(bottom.mean(0)).toBeCloseTo(40, 6)
    const h = handles(m).find((x) => x.key === 'noise')!
    const quiet = compileModel({ ...s, adjust: dragHandle(null, m, 'noise', h.c, m.mean(h.c) + m.sd(h.c))! })
    expect(quiet.sd(50)).toBeCloseTo(5, 6) // band edge dragged from +2 sd to +1 sd: half the noise
    const mid = handles(m).find((x) => x.key === 'mid')!
    const left = compileModel({ ...s, adjust: dragHandle(null, m, 'mid', mid.c / 2, mid.s)! })
    expect(left.mean(mid.c / 2)).toBeCloseTo(mid.s, 6)
  })

  it('a top drag still lands after the midpoint was moved', () => {
    const s = { ...line(), adjust: { bottom: 50, top: null, cScale: 2, sdScale: 1 } }
    const m = compileModel(s)
    expect(compileModel({ ...s, adjust: dragHandle(s.adjust, m, 'top', 100, 900)! }).mean(100)).toBeCloseTo(900, 4)
  })
})

describe('read sheet paste', () => {
  it('lands at the focused cell, runs right and down, skips a header row', () => {
    const rows = pasteBlock([], 0, 'id', 'Sample\tSignal\nA\t120\nB\t340,5')
    expect(rows).toEqual([
      { id: 'A', signal: 120, dilution: 1 },
      { id: 'B', signal: 340.5, dilution: 1 },
    ])
    const more = pasteBlock(rows, 1, 'signal', '99\t2\n77')
    expect(more.map((r) => [r.id, r.signal, r.dilution])).toEqual([['A', 120, 1], ['B', 99, 2], ['', 77, 1]])
  })
})

describe('sharing', () => {
  it('a link round-trips the whole series', async () => {
    const s = { ...line(), name: 'Lot 3 — µ', requirements: [{ kind: 'detect' as const, c: 2 }] }
    const payload = await encodeShare(s)
    expect(shareFromHash(`#s=${payload}`)).toBe(payload)
    expect(sanitizeSeries(await decodeShare(payload))).toEqual(sanitizeSeries(s))
    expect(await decodeShare('znot-a-payload')).toBeNull()
  })

  it('an exported report carries the series back', () => {
    const s = { ...line(), name: '</script><b>x' }
    const html = reportDocument('t', '<div>body</div>', '', s, 'http://x/#s=1')
    expect(sanitizeSeries(seriesFromReport(html)).name).toBe(s.name)
    expect(html.match(/<\/script>/g)).toHaveLength(1) // the name cannot close the data block early
  })
})

describe('example gallery', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s is a valid series with a detection limit', (_, ex) => {
    const s = sanitizeSeries({ ...defaultSeries(), ...ex.series })
    // nothing in the example is dropped or replaced by a default on the way in
    for (const [k, v] of Object.entries(ex.series)) if (typeof v !== 'object') expect(s[k as keyof Series], k).toEqual(v)
    expect(s.requirements).toHaveLength(ex.series.requirements?.length ?? 0)
    expect(s.samples).toHaveLength(ex.series.samples?.length ?? 0)
    const m = compileModel(s)
    expect(m.meanError ?? m.sdError).toBeUndefined()
    expect(limits(m, s.limits).lod).not.toBeNull()
  })
})
