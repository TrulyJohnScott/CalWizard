import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSeries } from '../math/presets'
import { undoKey } from './keys'
import { breakCoalescing, COALESCE_MS, HISTORY_LIMIT, isPending, rulerPoints, useStore } from './store'

const st = () => useStore.getState()
const active = () => st().series.find((x) => x.id === st().activeId)!
const initial = useStore.getState()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  useStore.setState(initial, true)
  breakCoalescing()
})
afterEach(() => vi.useRealTimers())

const later = (ms = COALESCE_MS + 1) => vi.setSystemTime(Date.now() + ms)

describe('undo / redo', () => {
  it('undoes and redoes a patch', () => {
    const before = active().meanExpr
    st().patch({ meanExpr: '1 + c' })
    expect(active().meanExpr).toBe('1 + c')
    st().undo()
    expect(active().meanExpr).toBe(before)
    expect(st().future).toHaveLength(1)
    st().redo()
    expect(active().meanExpr).toBe('1 + c')
    expect(st().future).toHaveLength(0)
  })

  it('coalesces a burst of the same kind of edit into one step', () => {
    for (const name of ['a', 'ab', 'abc']) {
      st().patch({ name })
      later(300)
    }
    expect(st().past).toHaveLength(1)
    st().undo()
    expect(active().name).toBe(defaultSeries().name)
  })

  it('keeps edits apart when the kind differs or the pause is long enough', () => {
    st().patch({ name: 'a' })
    st().patch({ units: 'pg/mL' })
    later()
    st().patch({ units: 'ng/L' })
    expect(st().past).toHaveLength(3)
  })

  it('breakCoalescing starts a new step (each drag is its own step)', () => {
    st().patch({ levels: [0, 2] })
    breakCoalescing()
    st().patch({ levels: [0, 3] })
    expect(st().past).toHaveLength(2)
  })

  it('records nothing for a patch that changes nothing', () => {
    st().patch({ name: active().name, levels: [...active().levels] })
    expect(st().past).toHaveLength(0)
  })

  it('a new edit after undo drops the redo branch', () => {
    st().patch({ name: 'a' })
    st().undo()
    st().patch({ units: 'x' })
    expect(st().future).toHaveLength(0)
    st().redo()
    expect(active().name).toBe(defaultSeries().name)
  })

  it('keeps at most HISTORY_LIMIT steps', () => {
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      st().patch({ cMax: 100 + i })
      later()
    }
    expect(st().past).toHaveLength(HISTORY_LIMIT)
  })

  it('undo/redo with empty stacks do nothing', () => {
    const s0 = st().series
    st().undo()
    st().redo()
    expect(st().series).toBe(s0)
  })

  it('undo clears the ladder list, the measurement, the zoom and the toast', () => {
    st().patch({ name: 'a' })
    useStore.setState({ ladder: { list: [0, 1] }, measure: { pts: [1, 2] }, focus: [0, 5], toast: { id: 1, text: 'x' } })
    st().undo()
    expect([st().ladder, st().measure, st().focus, st().toast]).toEqual([null, null, null, null])
  })

  it('replaceActive (Load JSON) is one undoable step', () => {
    const before = active()
    st().replaceActive({ ...defaultSeries(), name: 'loaded', meanExpr: '2*c' })
    expect(active().name).toBe('loaded')
    expect(active().id).toBe(before.id)
    st().undo()
    expect(active()).toEqual(before)
  })

  it('measuring never changes the levels and is not history', () => {
    const levels = active().levels
    st().clickMeasure(3)
    st().clickMeasure(7)
    st().setMeasurePoint(1, 9)
    expect(st().measure!.pts).toEqual([3, 9])
    expect(active().levels).toBe(levels)
    expect(st().past).toHaveLength(0)
  })

  it('UI preferences are not history', () => {
    st().setUi({ flip: true })
    expect(st().past).toHaveLength(0)
  })
})

describe('applyLadder', () => {
  it('equations mode: writes the levels as one undoable step', () => {
    const before = active().levels
    st().applyLadder([0, 1.5, 3])
    expect(active().levels).toEqual([0, 1.5, 3])
    expect(st().ladder).toBeNull()
    st().undo()
    expect(active().levels).toEqual(before)
  })

  it('equations mode: the same levels again is not a new step', () => {
    st().applyLadder([...active().levels])
    expect(st().past).toHaveLength(0)
  })

  it('table modes: shows the list in the sidebar and leaves the series alone', () => {
    st().patch({ mode: 'summary' })
    const n = st().past.length
    const series = st().series
    st().applyLadder([0, 4, 9])
    expect(st().ladder).toEqual({ list: [0, 4, 9] })
    expect(st().series).toBe(series)
    expect(st().past).toHaveLength(n)
  })
})

describe('toast', () => {
  it('notify sets a fresh toast each time; dismiss clears it', () => {
    st().notify('one')
    const a = st().toast!
    st().notify('two')
    expect(st().toast!.text).toBe('two')
    expect(st().toast!.id).not.toBe(a.id)
    st().dismissToast()
    expect(st().toast).toBeNull()
  })
})

describe('undoKey', () => {
  const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, tagName = 'DIV') => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
    target: { tagName, isContentEditable: false } as unknown as EventTarget,
  })
  it('maps the shortcuts', () => {
    expect(undoKey(ev('z', { ctrlKey: true }))).toBe('undo')
    expect(undoKey(ev('z', { metaKey: true }))).toBe('undo')
    expect(undoKey(ev('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo')
    expect(undoKey(ev('y', { ctrlKey: true }))).toBe('redo')
  })
  it('ignores other keys, missing modifiers, Alt, and text fields', () => {
    expect(undoKey(ev('z'))).toBeNull()
    expect(undoKey(ev('x', { ctrlKey: true }))).toBeNull()
    expect(undoKey(ev('z', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(undoKey(ev('y', { ctrlKey: true, shiftKey: true }))).toBeNull()
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) expect(undoKey(ev('z', { ctrlKey: true }, tag))).toBeNull()
    expect(undoKey({ ...ev('z', { ctrlKey: true }), target: { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget })).toBeNull()
    expect(undoKey({ ...ev('z', { ctrlKey: true }), target: null })).toBe('undo')
  })
})

describe('ruler (N points)', () => {
  it('each click adds a point (in placing order) and selects it; clicking a placed point selects it', () => {
    st().clickMeasure(5)
    expect(st().measure).toEqual({ pts: [5], sel: 0 })
    st().clickMeasure(2)
    st().clickMeasure(9)
    expect(st().measure).toEqual({ pts: [5, 2, 9], sel: 2 })
    st().clickMeasure(5)
    expect(st().measure).toEqual({ pts: [5, 2, 9], sel: 0 })
    st().selectMeasure(null)
    expect(st().measure!.sel).toBeNull()
    st().selectMeasure(7)
    expect(st().measure!.sel).toBeNull()
  })

  it('rulerPoints: blank first, sorted; the live point only while one point is placed', () => {
    expect(rulerPoints(null, 4)).toEqual([])
    expect(rulerPoints({ pts: [5] }, 2)).toEqual([0, 2, 5])
    expect(rulerPoints({ pts: [5] }, 5)).toEqual([0, 5])
    expect(rulerPoints({ pts: [5, 1] }, 3)).toEqual([0, 1, 5])
    expect(rulerPoints({ pts: [0, 4] }, null)).toEqual([0, 4])
    expect(isPending({ pts: [5] })).toBe(true)
    expect(isPending({ pts: [1, 5] })).toBe(false)
  })

  it('points can be dragged, never onto another point', () => {
    st().setMeasurePoint(0, 4)
    expect(st().measure).toBeNull()
    for (const c of [1, 5, 9]) st().clickMeasure(c)
    st().setMeasurePoint(0, 7)
    expect(st().measure).toEqual({ pts: [7, 5, 9], sel: 0 })
    st().setMeasurePoint(0, 9)
    st().setMeasurePoint(5, 2)
    expect(st().measure!.pts).toEqual([7, 5, 9])
  })

  it('popMeasure removes the selected point, else the last placed; the last one clears the ruler', () => {
    st().popMeasure()
    for (const c of [5, 1, 9]) st().clickMeasure(c)
    st().selectMeasure(0)
    st().popMeasure()
    expect(st().measure).toEqual({ pts: [1, 9], sel: null })
    st().popMeasure()
    expect(st().measure).toEqual({ pts: [1], sel: null })
    st().popMeasure()
    expect(st().measure).toBeNull()
  })

  it('Keep as levels adds every point as one undoable step (equations mode)', () => {
    const before = active().levels
    for (const c of [3, 7, 700]) st().clickMeasure(c)
    st().keepMeasure()
    expect(active().levels).toEqual([...new Set([...before, 3, 7, 700])].sort((a, b) => a - b))
    expect(active().cMax).toBe(700)
    expect(st().past).toHaveLength(1)
    st().keepMeasure()
    expect(st().past).toHaveLength(1)
    st().undo()
    expect(active().levels).toEqual(before)
  })

  it('Keep does nothing without points or in table modes; measuring is not history', () => {
    st().keepMeasure()
    expect(st().past).toHaveLength(0)
    st().patch({ mode: 'summary' })
    st().clickMeasure(3)
    st().clickMeasure(9)
    const series = st().series
    st().keepMeasure()
    expect(st().series).toBe(series)
  })

  it('clearMeasure', () => {
    st().clearMeasure()
    st().clickMeasure(3)
    st().clearMeasure()
    expect(st().measure).toBeNull()
  })
})

describe('simulated levels, reading, view reset', () => {
  it('Shift-click level: equations adds to levels (and extends cMax); table modes add to extraLevels', () => {
    expect(st().addSimLevel(7)).toBe(true)
    expect(active().levels).toContain(7)
    expect(st().addSimLevel(7)).toBe(false)
    expect(st().addSimLevel(900)).toBe(true)
    expect(active().cMax).toBe(900)
    st().undo()
    expect(active().levels).not.toContain(900)
    st().patch({ mode: 'summary' })
    expect(st().addSimLevel(3)).toBe(true)
    expect(active().extraLevels).toEqual([3])
    expect(st().addSimLevel(-1)).toBe(false)
    expect(st().addSimLevel(NaN)).toBe(false)
  })

  it('reading is set/cleared and is not history', () => {
    st().setReading(72)
    expect(st().reading).toBe(72)
    st().setReading(Infinity)
    expect(st().reading).toBeNull()
    expect(st().past).toHaveLength(0)
  })

  it('resetView clears the zoom and bumps the revision', () => {
    useStore.setState({ focus: [1, 2] })
    const r = st().viewRev
    st().resetView()
    expect(st().focus).toBeNull()
    expect(st().viewRev).toBe(r + 1)
  })
})
