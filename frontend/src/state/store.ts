import { create } from 'zustand'
import { defaultSeries } from '../math/presets'
import { normLevels } from '../math/tables'
import type { MetricKey, Mode, Series } from '../math/types'

export type Theme = 'system' | 'light' | 'dark'

export interface Ui {
  left: boolean
  sidebar: boolean
  flip: boolean
  shading: 'band' | 'heat' | 'lines'
  stepR: number
  jitter: number
  histBars: boolean
  /** sideways Gaussians at the right of the scatter (not when flipped) */
  marginal: boolean
  /** left panel shows the equations or the table (independent of which one drives the curve) */
  inputView: 'equations' | 'table'
  /** distribution panel shows the levels or the anchors (flips to anchors when anchors are placed) */
  distView: 'levels' | 'anchors'
  theme: Theme
}

export type Stored = Series & { id: string }

/** Display-only ladder shown in the Levels sidebar in table modes (equations mode writes the levels instead). */
export interface LadderState {
  list: number[]
}

/** What undo/redo restores: the series content only (UI prefs, zoom and measurement are not history). */
export interface Snap {
  series: Stored[]
  activeId: string
}

/** Simulated experiment settings (spec §13). UI state: never part of the Series or undo history. */
export interface ExpState {
  /** sidebar shows the Experiment view (and the scatter shows this run's readings) */
  open: boolean
  n: number
  /** table modes: n per column = readings actually measured */
  asMeasured: boolean
  runs: number
  seed: number
}

export interface Toast {
  id: number
  text: string
  /** what the toast's Undo does (default: undo the last series change) */
  undo?: () => void
}

export const HISTORY_LIMIT = 100
/** consecutive edits of the same kind within this many ms are one undo step */
export const COALESCE_MS = 1000

/** The ruler: any number of points in the order placed (unique); never part of the levels until "Keep as levels". */
export interface Measure {
  pts: number[]
  /** index (into pts) of the selected point, if any */
  sel?: number | null
}

/** One point placed: the next point is previewed live under the mouse. */
export const isPending = (m: Measure | null): boolean => !!m && m.pts.length === 1

/**
 * What the ruler compares, sorted: the blank (c = 0) as a fixed first anchor, the placed points, and the live point
 * under the mouse while only one point is placed.
 */
export function rulerPoints(m: Measure | null, live: number | null): number[] {
  if (!m) return []
  const pts = isPending(m) && live !== null ? [...m.pts, live] : m.pts
  return [...new Set([0, ...pts])].sort((a, b) => a - b)
}

interface State {
  series: Stored[]
  activeId: string
  ui: Ui
  ladder: LadderState | null
  measure: Measure | null
  exp: ExpState
  setExp: (p: Partial<ExpState>) => void
  /** a fit being hovered: drawn dashed on the chart before it is applied (UI state only) */
  ghost: { meanExpr?: string; sdExpr?: string } | null
  setGhost: (g: { meanExpr?: string; sdExpr?: string } | null) => void
  /** recovery: the signal line placed on the scatter (null = none); not undo history */
  reading: number | null
  setReading: (S: number | null) => void
  /** hovered concentration on the scatter (drives the probe Gaussian) */
  probe: number | null
  setProbe: (c: number | null) => void
  /** zoomed concentration window (null = whole range); both charts refit the signal axis to it */
  focus: [number, number] | null
  setFocus: (f: [number, number] | null) => void
  /** bumps on "reset view" so both charts re-apply the ranges computed from the current data */
  viewRev: number
  resetView: () => void
  /** change the active series (one undo step; same-key bursts within COALESCE_MS coalesce) */
  patch: (p: Partial<Series>) => void
  setUi: (p: Partial<Ui>) => void
  /** replace the active series wholesale (Load JSON): one undo step */
  replaceActive: (s: Series) => void
  setLadder: (l: LadderState | null) => void
  /** Ladder result: equations mode writes it as the levels (undoable), table modes show it in the sidebar */
  applyLadder: (levels: number[]) => void
  past: Snap[]
  future: Snap[]
  undo: () => void
  redo: () => void
  toast: Toast | null
  /** show "<text> · Undo" for a few seconds; `undo` overrides what Undo does (for changes outside the history) */
  notify: (text: string, undo?: () => void) => void
  dismissToast: () => void
  /** a click on the scatter at concentration c: adds a ruler point, or removes it if it is already there */
  clickMeasure: (c: number) => void
  /** drag ruler point i to c */
  setMeasurePoint: (i: number, c: number) => void
  /** remove the selected ruler point, or the most recently placed one */
  popMeasure: () => void
  /** select ruler point i (null = none) */
  selectMeasure: (i: number | null) => void
  /** replace the ruler points (auto-spacing); empty = no ruler */
  setMeasurePts: (pts: number[]) => void
  clearMeasure: () => void
  /** add every ruler point to the levels (equations mode): one undo step */
  keepMeasure: () => void
  /** add a simulated concentration (equations: levels; tables: extraLevels). One undo step; false if already there */
  addSimLevel: (c: number) => boolean
}

const KEY = 'calwizard.v2'

const defaultUi = (): Ui => ({ left: true, sidebar: true, flip: false, shading: 'band', stepR: 2, jitter: 30, histBars: false, marginal: true, inputView: 'equations', distView: 'levels', theme: 'system' })
const uid = () => Math.random().toString(36).slice(2, 9)

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null)

/** Merge untrusted JSON onto defaults so a stale / hand-edited file can never crash the app. */
export function sanitizeSeries(raw: unknown): Series {
  const d = defaultSeries()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const str = (v: unknown, f: string) => (typeof v === 'string' ? v : f)
  const mode: Mode = r.mode === 'replicates' || r.mode === 'summary' || r.mode === 'equations' ? r.mode : d.mode
  const metric: MetricKey = r.metric === 'dsum' || r.metric === 'zprime' || r.metric === 'ssmd' ? r.metric : d.metric
  const levels = Array.isArray(r.levels) ? normLevels(r.levels.filter(isNum)) : d.levels
  const rep = r.replicates as { concs?: unknown; cells?: unknown } | undefined
  const concs = Array.isArray(rep?.concs) ? (rep!.concs as unknown[]).map(numOrNull) : d.replicates.concs
  if (!concs.length || concs[0] !== 0) concs[0] = 0
  const cellsRaw = Array.isArray(rep?.cells) ? (rep!.cells as unknown[]) : d.replicates.cells
  const cells = concs.map((_, j) => (Array.isArray(cellsRaw[j]) ? (cellsRaw[j] as unknown[]).map(numOrNull) : []))
  const summary = Array.isArray(r.summary)
    ? (r.summary as Record<string, unknown>[]).map((x) => ({ c: numOrNull(x?.c), mean: numOrNull(x?.mean), sd: numOrNull(x?.sd) }))
    : d.summary
  if (!summary.length || summary[0].c !== 0) summary.unshift({ c: 0, mean: null, sd: null })
  const sim = r.sim as { n?: unknown; seed?: unknown } | undefined
  return {
    name: str(r.name, d.name),
    units: str(r.units, d.units),
    signalLabel: str(r.signalLabel, d.signalLabel),
    mode,
    meanExpr: str(r.meanExpr, d.meanExpr),
    sdExpr: str(r.sdExpr, d.sdExpr),
    levels,
    cMax: isNum(r.cMax) && r.cMax > 0 ? r.cMax : levels[levels.length - 1] || 1,
    replicates: { concs, cells },
    extraLevels: Array.isArray(r.extraLevels) ? [...new Set(r.extraLevels.filter(isNum).filter((c) => c >= 0))].sort((a, b) => a - b) : [],
    summary,
    metric,
    kTarget: isNum(r.kTarget) ? r.kTarget : metric === 'zprime' ? 0.5 : 3,
    sim: { n: isNum(sim?.n) ? Math.max(0, Math.floor(sim!.n as number)) : 5, seed: isNum(sim?.seed) ? Math.floor(sim!.seed as number) : 42 },
  }
}

function load(): { series: Stored[]; activeId: string; ui: Ui } {
  const fresh = () => {
    const id = uid()
    return { series: [{ ...defaultSeries(), id }], activeId: id, ui: defaultUi() }
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fresh()
    const j = JSON.parse(raw) as { series?: unknown[]; activeId?: string; ui?: Partial<Ui> }
    const series = (j.series ?? []).map((s) => ({ ...sanitizeSeries(s), id: String((s as { id?: string })?.id ?? uid()) }))
    if (!series.length) return fresh()
    const activeId = series.some((s) => s.id === j.activeId) ? (j.activeId as string) : series[0].id
    return { series, activeId, ui: { ...defaultUi(), ...(j.ui ?? {}) } }
  } catch {
    return fresh()
  }
}

// coalescing state for history (module level: it is about timing, not data)
let lastTag = ''
let lastAt = 0
let toastId = 0

/** History entry for a change about to happen. Same `tag` within COALESCE_MS extends the previous step. */
function record(s: State, tag: string): Pick<State, 'past' | 'future'> | Record<string, never> {
  const now = Date.now()
  const coalesce = tag !== '' && tag === lastTag && now - lastAt < COALESCE_MS
  lastTag = tag
  lastAt = now
  if (coalesce) return {}
  return { past: [...s.past.slice(-(HISTORY_LIMIT - 1)), { series: s.series, activeId: s.activeId }], future: [] }
}

/** Forget the coalescing window (the next edit always starts a new step). */
export function breakCoalescing(): void {
  lastTag = ''
}

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

export const useStore = create<State>((set) => ({
  ...load(),
  ladder: null,
  measure: null,
  probe: null,
  setProbe: (probe) => set({ probe }),
  exp: { open: false, n: 4, asMeasured: false, runs: 200, seed: 1 },
  ghost: null,
  setGhost: (ghost) => set({ ghost }),
  setExp: (p) => set((s) => ({ exp: { ...s.exp, ...p } })),
  reading: null,
  setReading: (reading) => set({ reading: reading !== null && Number.isFinite(reading) ? reading : null }),
  focus: null,
  setFocus: (focus) => set({ focus: focus && focus[1] > focus[0] ? focus : null }),
  viewRev: 0,
  resetView: () => set((s) => ({ focus: null, viewRev: s.viewRev + 1 })),
  patch: (p) =>
    set((s) => {
      const act = s.series.find((x) => x.id === s.activeId)
      const keys = Object.keys(p) as (keyof Series)[]
      if (!act || keys.every((k) => sameValue(act[k], p[k]))) return {}
      return { ...record(s, `patch:${keys.sort().join(',')}`), series: s.series.map((x) => (x.id === s.activeId ? { ...x, ...p } : x)) }
    }),
  replaceActive: (n) =>
    set((s) => ({ ...record(s, ''), series: s.series.map((x) => (x.id === s.activeId ? { ...n, id: x.id } : x)), ladder: null, measure: null, focus: null })),
  setUi: (p) => set((s) => ({ ui: { ...s.ui, ...p } })),
  setLadder: (ladder) => set({ ladder }),
  applyLadder: (levels) =>
    set((s) => {
      const act = s.series.find((x) => x.id === s.activeId)
      if (!act) return {}
      if (act.mode !== 'equations') return { ladder: { list: levels }, measure: null }
      if (sameValue(act.levels, levels)) return { ladder: null }
      return { ...record(s, ''), series: s.series.map((x) => (x.id === s.activeId ? { ...x, levels } : x)), ladder: null, measure: null }
    }),
  past: [],
  future: [],
  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1]
      if (!prev) return {}
      lastTag = ''
      return {
        past: s.past.slice(0, -1),
        future: [...s.future, { series: s.series, activeId: s.activeId }],
        series: prev.series,
        activeId: prev.activeId,
        ladder: null,
        measure: null,
        focus: null,
        toast: null,
      }
    }),
  redo: () =>
    set((s) => {
      const next = s.future[s.future.length - 1]
      if (!next) return {}
      lastTag = ''
      return {
        future: s.future.slice(0, -1),
        past: [...s.past, { series: s.series, activeId: s.activeId }],
        series: next.series,
        activeId: next.activeId,
        ladder: null,
        measure: null,
        focus: null,
        toast: null,
      }
    }),
  toast: null,
  notify: (text, undo) => set({ toast: { id: ++toastId, text, undo } }),
  dismissToast: () => set({ toast: null }),
  clickMeasure: (c) =>
    set((s) => {
      const pts = s.measure?.pts ?? []
      const j = pts.indexOf(c)
      if (j >= 0) return { measure: { pts, sel: j } } // clicking a placed point selects it
      return { measure: { pts: [...pts, c], sel: pts.length } }
    }),
  setMeasurePts: (pts) => {
    const u = [...new Set(pts.filter((c) => Number.isFinite(c) && c >= 0))]
    set({ measure: u.length ? { pts: u, sel: null } : null })
  },
  selectMeasure: (i) => set((s) => (s.measure ? { measure: { ...s.measure, sel: i !== null && i >= 0 && i < s.measure.pts.length ? i : null } } : {})),
  popMeasure: () =>
    set((s) => {
      const m = s.measure
      if (!m) return {}
      const drop = m.sel !== null && m.sel !== undefined ? m.sel : m.pts.length - 1
      const pts = m.pts.filter((_, i) => i !== drop)
      return { measure: pts.length ? { pts, sel: null } : null }
    }),
  setMeasurePoint: (i, c) =>
    set((s) => {
      const pts = s.measure?.pts
      if (!pts || i < 0 || i >= pts.length || pts[i] === c || pts.includes(c)) return {}
      const next = [...pts]
      next[i] = c
      return { measure: { pts: next, sel: i } }
    }),
  clearMeasure: () => set((s) => (s.measure ? { measure: null } : {})),
  addSimLevel: (c) => {
    let added = false
    set((s) => {
      const act = s.series.find((x) => x.id === s.activeId)
      if (!act || !(c >= 0) || !Number.isFinite(c)) return {}
      const key = act.mode === 'equations' ? 'levels' : 'extraLevels'
      const cur = act.mode === 'equations' ? normLevels(act.levels) : act.extraLevels ?? []
      if (cur.includes(c)) return {}
      added = true
      const next = [...cur, c].sort((a, b) => a - b)
      return {
        ...record(s, ''),
        series: s.series.map((x) => (x.id === s.activeId ? { ...x, [key]: next, ...(act.mode === 'equations' && c > x.cMax ? { cMax: c } : {}) } : x)),
        ladder: null,
      }
    })
    return added
  },
  keepMeasure: () =>
    set((s) => {
      const m = s.measure
      const act = s.series.find((x) => x.id === s.activeId)
      if (!m || !act || act.mode !== 'equations') return {}
      const levels = normLevels([...act.levels, ...m.pts])
      if (sameValue(levels, normLevels(act.levels))) return {}
      return {
        ...record(s, ''),
        series: s.series.map((x) => (x.id === s.activeId ? { ...x, levels, cMax: Math.max(x.cMax, ...m.pts) } : x)),
        ladder: null,
      }
    }),
}))

export const useActive = (): Stored => useStore((s) => s.series.find((x) => x.id === s.activeId) ?? s.series[0])

let timer: ReturnType<typeof setTimeout> | 0 = 0
useStore.subscribe((s) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ series: s.series, activeId: s.activeId, ui: s.ui }))
    } catch {
      /* storage unavailable */
    }
  }, 300)
})
