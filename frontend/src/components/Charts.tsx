import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { buildCalibration } from '../charts/calibration'
import { concRange } from '../charts/common'
import { buildHistogram } from '../charts/histogram'
import { usePlot, loadPlotly } from '../charts/usePlot'
import { fmt } from '../format'
import { inverse } from '../math/analysis'
import { compileExpr } from '../math/expr'
import { dragHandle, handles } from '../math/whatif'
import type { Derived } from '../state/derived'
import type { RepeatResult } from '../state/repeat'
import { breakCoalescing, isPending, rulerPoints, useStore, type Measure } from '../state/store'
import { usePalette } from '../theme'
import { autoSpace } from '../state/autospace'
import { PointsField } from './PointsField'
import { evalCurve } from '../state/points'
import { HistHover, ScatterHover } from './HoverOverlay'
import { Seg } from './ui'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Concentration under the mouse (x in c → S, y in S → c), or null outside the plot area. Never below 0. */
function concAt(gd: any, e: { clientX: number; clientY: number }, flip: boolean): number | null {
  const fl = gd._fullLayout
  if (!fl?.xaxis || !fl.yaxis) return null
  const r = gd.getBoundingClientRect()
  const px = e.clientX - r.left
  const py = e.clientY - r.top
  const xa = fl.xaxis
  const ya = fl.yaxis
  if (px < xa._offset || px > xa._offset + xa._length || py < ya._offset || py > ya._offset + ya._length) return null
  const v = flip ? ya.p2d(py - ya._offset) : xa.p2d(px - xa._offset)
  return Number.isFinite(v) ? Math.max(0, v) : null
}

interface Target {
  i: number
  x: number
  y: number
  /** cursor / drag direction for this target (default: the chart's) */
  axis?: 'ew' | 'ns'
}

/** What-if handle k is drag target WHATIF + k. */
const WHATIF = 1_000_000

/** Pointer-down within ~8px of a target starts a drag (capturing the event so Plotly's zoom does not start). */
function useDrag(
  ref: RefObject<HTMLDivElement | null>,
  cfg: { enabled: boolean; axis: 'ew' | 'ns'; targets: () => Target[]; onMove: (i: number, x: number, y: number) => void; onStart: (i: number) => void; onEnd: (i: number) => void },
) {
  const cur = useRef(cfg)
  cur.current = cfg
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const hit = (e: MouseEvent): Target | null => {
      if (!cur.current.enabled) return null
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      let best: Target | null = null
      let bd = 8
      for (const t of cur.current.targets()) {
        const d = Math.hypot(t.x - x, t.y - y)
        if (d <= bd) {
          bd = d
          best = t // later targets win ties (ruler handles are listed last)
        }
      }
      return best
    }
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || e.shiftKey || (e.target as Element).closest?.('.modebar')) return
      const t = hit(e)
      if (!t) return
      e.stopPropagation()
      e.preventDefault()
      cur.current.onStart(t.i)
      el.dataset.cursor = t.axis ?? cur.current.axis
      const mv = (ev: MouseEvent) => {
        const r = el.getBoundingClientRect()
        cur.current.onMove(t.i, ev.clientX - r.left, ev.clientY - r.top)
      }
      const up = () => {
        window.removeEventListener('mousemove', mv)
        window.removeEventListener('mouseup', up)
        cur.current.onEnd(t.i)
        el.dataset.cursor = ''
      }
      window.addEventListener('mousemove', mv)
      window.addEventListener('mouseup', up)
    }
    const hover = (e: MouseEvent) => {
      if (e.buttons) return
      const h = hit(e)
      el.dataset.cursor = h ? h.axis ?? cur.current.axis : ''
    }
    el.addEventListener('mousedown', down, true)
    el.addEventListener('mousemove', hover)
    return () => {
      el.removeEventListener('mousedown', down, true)
      el.removeEventListener('mousemove', hover)
    }
  }, [ref])
}

/** Ruler point i is drag target -(i + 1). */
const rulerId = (i: number) => -(i + 1)

/** rAF-throttled mover: levels clamp between neighbours (3 significant digits); ruler ends move freely (c ≥ 0). */
function useLevelMover(d: Derived) {
  const live = useRef(d)
  live.current = d
  const pending = useRef<{ i: number; c: number } | null>(null)
  const raf = useRef(0)
  const apply = () => {
    raf.current = 0
    const p = pending.current
    pending.current = null
    if (!p) return
    const c3 = (c: number) => +Math.max(0, c).toPrecision(3)
    if (p.i < 0) {
      useStore.getState().setMeasurePoint(-p.i - 1, c3(p.c))
      return
    }
    const { listed, model } = live.current
    const i = p.i
    if (i <= 0 || i >= listed.length) return
    const gap = model.cMax * 1e-4
    const lo = listed[i - 1] + gap
    const hi = i + 1 < listed.length ? listed[i + 1] - gap : Infinity
    if (!(hi >= lo)) return
    let c = Math.min(hi, Math.max(lo, p.c))
    const r = c3(c)
    if (r >= lo && r <= hi) c = r
    if (c === listed[i]) return
    const levels = [...listed]
    levels[i] = c
    useStore.getState().patch({ levels, ...(c > model.cMax ? { cMax: c } : {}) })
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  return {
    move: (i: number, c: number) => {
      pending.current = { i, c }
      if (!raf.current) raf.current = requestAnimationFrame(apply)
    },
    flush: () => {
      cancelAnimationFrame(raf.current)
      apply()
    },
  }
}

/** Levels editable by dragging (equations mode, no display-only ladder) + the committed ruler's two handles (last). */
function dragTargets(d: Derived, editable: boolean, measure: { pts: number[] } | null, at: (c: number) => [number, number] | null, atAnchor = at): Target[] {
  const out: Target[] = []
  if (editable)
    d.listed.forEach((c, i) => {
      if (i === 0) return
      const p = at(c)
      if (p) out.push({ i, x: p[0], y: p[1] })
    })
  if (measure)
    measure.pts.forEach((c, j) => {
      const p = atAnchor(c)
      if (p) out.push({ i: rulerId(j), x: p[0], y: p[1] })
    })
  return out
}

export function CalibrationChart({ d, repeat = null }: { d: Derived; repeat?: RepeatResult | null }) {
  const ui = useStore((s) => s.ui)
  const measure = useStore((s) => s.measure)
  const clickMeasure = useStore((s) => s.clickMeasure)
  const setLadder = useStore((s) => s.setLadder)
  const lad = useStore((s) => s.ladder)
  // the hovered concentration only matters to the figure while a measurement waits for its second point
  const probe = useStore((s) => (isPending(s.measure) ? s.probe : null))
  const setProbe = useStore((s) => s.setProbe)
  const viewRev = useStore((s) => s.viewRev)
  const resetView = useStore((s) => s.resetView)
  const reading = useStore((s) => s.reading)
  const setReading = useStore((s) => s.setReading)
  const setUi = useStore((s) => s.setUi)
  const pal = usePalette()
  const { series, model, dots, listed, range, focus } = d
  const setFocus = useStore((s) => s.setFocus)
  const live = isPending(measure) ? probe : null
  const ghostSrc = useStore((s) => s.ghost)
  const ghost = useMemo(() => {
    if (!ghostSrc) return null
    const m = ghostSrc.meanExpr ? compileExpr(ghostSrc.meanExpr, 'c') : null
    const sd = ghostSrc.sdExpr ? compileExpr(ghostSrc.sdExpr, 'S') : null
    return { mean: m?.ok ? m.fn : undefined, sd: sd?.ok ? sd.fn : undefined }
  }, [ghostSrc])
  const estimates = useMemo(() => d.exp?.first.levels.map((l) => ({ c: l.c, mean: l.mean })) ?? null, [d.exp])
  const limitTicks = useMemo(() => (ui.showLimits && d.limits ? { lod: d.limits.lod?.c ?? null, loq: d.limits.loq?.c ?? null, lob: d.limits.lob.signal } : null), [ui.showLimits, d.limits])
  const pointCurve = useMemo(() => evalCurve(series, model), [series, model])
  const spec = useMemo(
    () => buildCalibration({ pointCurve, repeat, series, model, dots, listed, flip: ui.flip, jitter: ui.jitter, measure, live, range, focus, viewRev, reading, probe: null, onCurve: ui.marginal, estimates, ghost, ladderTicks: d.resolvable, whatIf: ui.whatIf, limitTicks, pal }),
    [pointCurve, repeat, series, model, dots, listed, ui.flip, ui.jitter, measure, live, range, focus, viewRev, reading, ui.marginal, estimates, ghost, d.resolvable, ui.whatIf, limitTicks, pal],
  )
  const ref = usePlot(spec)
  const down = useRef<{ x: number; y: number } | null>(null)
  /** ruler state before the latest single click, so a double-click (view reset) can take that click back */
  const beforeClick = useRef<Measure | null>(null)
  const mover = useLevelMover(d)
  // while the what-if handles are out, levels are not draggable (the handles sit on the first and last level)
  const editable = series.mode === 'equations' && !lad?.list && !ui.whatIf
  /** the series and model when a what-if drag began: every move is measured from there */
  const dragStart = useRef<Derived | null>(null)
  useDrag(ref, {
    enabled: true,
    axis: ui.flip ? 'ns' : 'ew',
    targets: () => {
      const fl = (ref.current as any)?._fullLayout
      if (!fl?.xaxis) return []
      const { xaxis: xa, yaxis: ya } = fl
      const px = (c: number, S: number): [number, number] => [xa._offset + xa.d2p(ui.flip ? S : c), ya._offset + ya.d2p(ui.flip ? c : S)]
      const out = dragTargets(d, editable, measure, (c) => {
        const p = px(c, model.mean(c))
        return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null
      })
      if (ui.whatIf)
        handles(model).forEach((h, k) => {
          const p = px(h.c, h.s)
          const along = h.axis === 'conc' ? (ui.flip ? 'ns' : 'ew') : ui.flip ? 'ew' : 'ns'
          if (Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push({ i: WHATIF + k, x: p[0], y: p[1], axis: along })
        })
      return out
    },
    onStart: (i) => {
      down.current = null
      if (i >= WHATIF) {
        breakCoalescing()
        dragStart.current = d
        useStore.getState().setHold(d.range)
      } else if (i > 0) {
        breakCoalescing()
        setLadder(null)
      } else useStore.getState().selectMeasure(-i - 1)
    },
    onMove: (i, x, y) => {
      const fl = (ref.current as any)._fullLayout
      if (i >= WHATIF) {
        const cur = dragStart.current ?? d
        const c = (ui.flip ? fl.yaxis : fl.xaxis).p2d((ui.flip ? y : x) - (ui.flip ? fl.yaxis : fl.xaxis)._offset)
        const S = (ui.flip ? fl.xaxis : fl.yaxis).p2d((ui.flip ? x : y) - (ui.flip ? fl.xaxis : fl.yaxis)._offset)
        const next = dragHandle(cur.series.adjust, cur.model, handles(cur.model)[i - WHATIF].key, c, S)
        if (next !== undefined) useStore.getState().patch({ adjust: next })
        return
      }
      mover.move(i, ui.flip ? fl.yaxis.p2d(y - fl.yaxis._offset) : fl.xaxis.p2d(x - fl.xaxis._offset))
    },
    onEnd: (i) => {
      if (i < WHATIF) return mover.flush()
      dragStart.current = null
      useStore.getState().setHold(null)
    },
  })
  // the recovery line: grab it anywhere within 6px and drag along the signal axis
  const rd = useRef({ reading, flip: ui.flip })
  rd.current = { reading, flip: ui.flip }
  useEffect(() => {
    const el = ref.current as any
    if (!el) return
    const pos = (e: MouseEvent) => {
      const fl = el._fullLayout
      if (!fl?.xaxis) return null
      const r = el.getBoundingClientRect()
      const ax = rd.current.flip ? fl.xaxis : fl.yaxis
      const p = rd.current.flip ? e.clientX - r.left - ax._offset : e.clientY - r.top - ax._offset
      return { ax, p }
    }
    const near = (e: MouseEvent) => {
      const S = rd.current.reading
      const q = pos(e)
      return S !== null && q !== null && Math.abs(q.ax.d2p(S) - q.p) <= 6
    }
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || !near(e)) return
      e.stopPropagation()
      e.preventDefault()
      const mv = (ev: MouseEvent) => {
        const q = pos(ev)
        if (q) setReading(+q.ax.p2d(q.p).toPrecision(4))
      }
      const up = () => {
        window.removeEventListener('mousemove', mv)
        window.removeEventListener('mouseup', up)
        el.dataset.cursor = ''
      }
      el.dataset.cursor = rd.current.flip ? 'ew' : 'ns'
      window.addEventListener('mousemove', mv)
      window.addEventListener('mouseup', up)
    }
    const hover = (e: MouseEvent) => {
      if (!e.buttons && near(e)) el.dataset.cursor = rd.current.flip ? 'ew' : 'ns'
    }
    el.addEventListener('mousedown', down, true)
    el.addEventListener('mousemove', hover)
    return () => {
      el.removeEventListener('mousedown', down, true)
      el.removeEventListener('mousemove', hover)
    }
  }, [ref, setReading])

  const raf = useRef(0)
  const lv = useRef({ flip: ui.flip, cMax: model.cMax })
  lv.current = { flip: ui.flip, cMax: model.cMax }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  // Box-zoom / pan on the concentration axis -> focus window (may reach past cMax: the curve continues).
  useEffect(() => {
    let el: any = null
    let timer = 0
    const onRelayout = (ev: Record<string, unknown>) => {
      const { flip, cMax } = lv.current
      const ka = flip ? 'yaxis' : 'xaxis'
      if (ev[`${ka}.autorange`]) return setFocus(null)
      const r0 = ev[`${ka}.range[0]`] ?? (ev[`${ka}.range`] as number[] | undefined)?.[0]
      const r1 = ev[`${ka}.range[1]`] ?? (ev[`${ka}.range`] as number[] | undefined)?.[1]
      if (typeof r0 !== 'number' || typeof r1 !== 'number') return
      const lo = Math.max(0, Math.min(r0, r1))
      const hi = Math.max(r0, r1)
      if (!(hi > lo)) return
      const whole = lo <= 0.02 * cMax && hi >= 0.98 * cMax && hi <= 1.05 * cMax
      setFocus(whole ? null : [lo, hi])
    }
    const attach = () => {
      el = ref.current as any
      if (!el?.on) {
        timer = window.setTimeout(attach, 200)
        return
      }
      el.on('plotly_relayout', onRelayout)
    }
    attach()
    return () => {
      clearTimeout(timer)
      el?.removeListener?.('plotly_relayout', onRelayout)
    }
  }, [ref, setFocus])

  const onModebar = (t: EventTarget) => (t as Element).closest?.('.modebar') !== null
  return (
    <>
      <div className="absolute z-10 flex items-center gap-1" style={{ right: 36, top: 6 }}>
        <button
          className="btn"
          style={{ height: 24, fontSize: 11.5 }}
          title="Place round concentrations (1, 2, 5, 10, 20, 50 …) from 0, each one apart from the one below"
          onClick={() => autoSpace(d)}
        >
          Fill
        </button>
        <Seg
          value={String(ui.repeat) as '0' | '1' | '100' | '1000'}
          options={[
            ['0', 'Once', 'The curve as given (no simulated repeats)'],
            ['1', '×1', 'One simulated repeat of the experiment: the same strips per point, drawn from this curve as the truth'],
            ['100', '×100', '100 simulated repeats: how much a calibration could differ by chance'],
            ['1000', '×1000', '1000 simulated repeats'],
          ]}
          onChange={(v) => setUi({ repeat: Number(v) as 0 | 1 | 100 | 1000 })}
        />
        {measure && (
          <button className="btn" style={{ height: 24, fontSize: 11.5 }} title="Remove all anchors (Esc)" onClick={() => useStore.getState().clearMeasure()}>
            Clear
          </button>
        )}
        {reading !== null && (
          <button className="btn" style={{ height: 24, fontSize: 11.5 }} title="Remove the reading line (Esc)" onClick={() => setReading(null)}>
            Reading ×
          </button>
        )}
      </div>
      <div className="absolute z-10" style={{ left: 66, top: 36 }}>
        <PointsField d={d} />
      </div>
      {focus && (
        <button className="btn absolute z-10" style={{ left: 66, top: 62, height: 22, fontSize: 11 }} onClick={resetView} title="Back to the whole range (or double-click the chart)">
          {fmt(focus[0], 3)}–{fmt(focus[1], 3)}
          {series.units ? ` ${series.units}` : ''} · Show all
        </button>
      )}
      <ScatterHover plot={ref} model={model} listed={listed} flip={ui.flip} onCurve={ui.marginal} />
      <div
        ref={ref}
        data-plot="scatter"
        className="absolute inset-0 cursor-crosshair"
        onMouseDown={(e) => {
          down.current = e.button === 0 && !onModebar(e.target) ? { x: e.clientX, y: e.clientY } : null
        }}
        onClick={(e) => {
          const p = down.current
          down.current = null
          if (onModebar(e.target)) return
          if (e.detail === 2) {
            // double-click: whole range again (Plotly swallows dblclick, so detect it here) and undo the first click
            useStore.setState({ measure: beforeClick.current })
            resetView()
            return
          }
          if (!p || e.detail > 2 || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= 4) return // drag = zoom, not a click
          const raw = concAt(ref.current, e, lv.current.flip)
          if (raw === null) return
          // core design: Alt+click places a point (2 significant figures); a plain click selects the nearest point
          // within 9px, or clears the selection
          const pts = useStore.getState().measure?.pts ?? []
          if (!e.altKey) {
            const fl = (ref.current as any)._fullLayout
            const ax = lv.current.flip ? fl.yaxis : fl.xaxis
            let best = 9
            let pick = -1
            pts.forEach((t, j) => {
              const dpx = Math.abs(ax.d2p(t) - ax.d2p(raw))
              if (dpx <= best) {
                best = dpx
                pick = j
              }
            })
            useStore.getState().selectMeasure(pick >= 0 ? pick : null)
            return
          }
          if (!(raw > 0)) return
          beforeClick.current = useStore.getState().measure
          clickMeasure(+raw.toPrecision(2))
        }}
        onMouseMove={(e) => {
          if (e.buttons || onModebar(e.target)) return
          const ev = { clientX: e.clientX, clientY: e.clientY }
          cancelAnimationFrame(raf.current)
          raf.current = requestAnimationFrame(() => {
            setProbe(ref.current ? concAt(ref.current, ev, lv.current.flip) : null)
          })
        }}
        onMouseLeave={() => {
          cancelAnimationFrame(raf.current)
          setProbe(null)
        }}
      />
    </>
  )
}

export function HistogramChart({ d }: { d: Derived }) {
  const setUi = useStore((s) => s.setUi)
  const flip = useStore((s) => s.ui.flip)
  const measure = useStore((s) => s.measure)
  const hasAnchors = !!measure
  // placing anchors flips the panel to them; clearing them flips back
  useEffect(() => setUi({ distView: hasAnchors ? 'anchors' : 'levels' }), [hasAnchors, setUi])
  const showAnchors = hasAnchors
  const probe = useStore((s) => (isPending(s.measure) ? s.probe : null))
  const lad = useStore((s) => s.ladder)
  const setLadder = useStore((s) => s.setLadder)
  const viewRev = useStore((s) => s.viewRev)
  const resetView = useStore((s) => s.resetView)
  const pal = usePalette()
  const { series, model, dots, listed, range, focus } = d
  const space = flip ? 'signal' : 'conc'
  const xRange = useMemo<[number, number]>(() => (flip ? range : concRange(model.cMax, focus)), [flip, range, model.cMax, focus])
  const pair = useMemo(() => (measure ? rulerPoints(measure, isPending(measure) ? probe : null) : null), [measure, probe])
  const spec = useMemo(
    () => buildHistogram({ series, model, listed, dots, histBars: false, pair, probe: null, space, xRange, viewRev, show: { levels: !showAnchors, anchors: showAnchors }, pal }),
    [series, model, listed, dots, pair, space, xRange, viewRev, showAnchors, pal],
  )
  const ref = usePlot(spec)
  const mover = useLevelMover(d)
  const editable = series.mode === 'equations' && !lad?.list
  useDrag(ref, {
    enabled: true,
    axis: 'ew',
    targets: () => {
      const fl = (ref.current as any)?._fullLayout
      if (!fl?.xaxis) return []
      const xa = fl.xaxis
      const pos = (lane: 'levels' | 'anchors') => {
        const peak = new Map(spec.targets.filter((t) => t.lane === lane).map((t) => [t.c, t]))
        return (c: number): [number, number] | null => {
          const t = peak.get(c)
          const ya = t && fl[t.yaxis]
          if (!t || !ya) return null
          const px = xa._offset + xa.d2p(t.x)
          const py = ya._offset + ya.d2p(t.y)
          return Number.isFinite(px) && Number.isFinite(py) ? [px, py] : null
        }
      }
      return dragTargets(d, editable, measure, pos('levels'), pos('anchors'))
    },
    onStart: (i) => {
      if (i > 0) {
        breakCoalescing()
        setLadder(null)
      }
    },
    onMove: (i, x) => {
      const fl = (ref.current as any)._fullLayout
      const v = fl.xaxis.p2d(x - fl.xaxis._offset)
      const c = space === 'conc' ? v : inverse(model, v)
      if (c !== null && Number.isFinite(c)) mover.move(i, c)
    },
    onEnd: () => mover.flush(),
  })
  return (
    <>
    <HistHover plot={ref} model={model} space={space} xRange={xRange} top={spec.top} skip={[...listed, ...(pair ?? [])]} />
    <div
      ref={ref}
      data-plot="hist"
      className="absolute inset-0"
      onClick={(e) => {
        if (e.detail === 2 && !(e.target as Element).closest?.('.modebar')) resetView()
      }}
    />
    </>
  )
}

/** The histogram shares the scatter's x axis (concentration when c → S, signal when S → c): zoom/pan together. */
export function useLinkedSignalAxis(flip: boolean) {
  useEffect(() => {
    let off: (() => void) | null = null
    let stopped = false
    const attach = async () => {
      const a = document.querySelector<any>('[data-plot="scatter"]')
      const b = document.querySelector<any>('[data-plot="hist"]')
      if (!a?.on || !b?.on || !a._fullLayout || !b._fullLayout) return false
      const P = await loadPlotly()
      if (stopped) return true
      let busy = false
      const mk = (src: any, dst: any) => (ev: Record<string, unknown>) => {
        if (busy || !Object.keys(ev).some((k) => k.startsWith('xaxis'))) return
        const r = src._fullLayout?.xaxis?.range
        if (!r || !dst?._fullLayout || !document.contains(dst)) return // chart was replaced (e.g. hot reload)
        busy = true
        Promise.resolve(P.relayout(dst, { 'xaxis.range': [r[0], r[1]] }))
          .catch(() => undefined)
          .finally(() => (busy = false))
      }
      const fa = mk(a, b)
      const fb = mk(b, a)
      a.on('plotly_relayout', fa)
      b.on('plotly_relayout', fb)
      off = () => {
        a.removeListener?.('plotly_relayout', fa)
        b.removeListener?.('plotly_relayout', fb)
      }
      return true
    }
    const t = setInterval(() => {
      attach().then((ok) => ok && clearInterval(t))
    }, 250)
    return () => {
      stopped = true
      clearInterval(t)
      off?.()
    }
  }, [flip])
}
