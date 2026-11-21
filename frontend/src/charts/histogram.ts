import type { Data, Layout } from 'plotly.js'
import { fmt, pct } from '../format'
import { inverse, pairRow } from '../math/analysis'
import { closenessColor, closenessQ, rgbaCss } from '../math/closeness'
import type { Model } from '../math/model'
import type { LevelDots } from '../math/sim'
import type { Series } from '../math/types'
import { levelColor, type Palette } from '../theme'
import { axisStyle, baseLayout, linspace, MARGIN } from './common'
import type { PlotSpec } from './usePlot'

/**
 * Distribution panel under the scatter. It always shares the scatter's x axis (spec §11, v2.4):
 * - `conc` (scatter c → S): each level's signal N(mean(c), sd(c)) read back through the curve, i.e. the density of
 *   the concentration a single reading would be assigned: p(x) = φ((mean(x) − μ)/σ)/σ · |mean′(x)|.
 * - `signal` (scatter S → c): N(mean(c), sd(c)) on the signal axis.
 * Both are true densities (equal area; tight = tall), scaled so the tallest drawn level peaks at 1.
 */
export type HistSpace = 'conc' | 'signal'

export interface HistogramIn {
  series: Series
  model: Model
  /** sidebar concentrations */
  listed: number[]
  dots: LevelDots[]
  histBars: boolean
  /** ruler points (committed + live), emphasised; their adjacent pairs get the overlap fills */
  pair: number[] | null
  probe: number | null
  space: HistSpace
  /** the scatter's x range (signal range when `signal`, concentration range when `conc`) */
  xRange: [number, number]
  /** bumps when the user resets the view (double-click) so Plotly re-applies the computed range */
  viewRev: number
  /** which lanes to draw */
  show: { levels: boolean; anchors: boolean }
  pal: Palette
}

export interface HistSpec extends PlotSpec {
  /** drag handles: each drawn concentration's peak in data coordinates, per lane */
  targets: { c: number; x: number; y: number; lane: 'levels' | 'anchors'; yaxis: 'yaxis' | 'yaxis2' }[]
  /** density that maps to height 1 (the hover overlay draws on the same scale) */
  top: number
}

export const SPAN = 4.5
const SQ2PI = Math.sqrt(2 * Math.PI)

/** One level's distribution in the chosen space: unnormalised density f, a drawing grid, and its peak. */
export interface Dist {
  c: number
  f: (x: number) => number
  xs: number[]
  lo: number
  hi: number
  mode: number
  peak: number
}

export function signalDist(m: Pick<Model, 'mean' | 'sd'>, c: number): Dist | null {
  const mu = m.mean(c)
  const sd = m.sd(c)
  if (!Number.isFinite(mu) || !(sd > 0) || !Number.isFinite(sd)) return null
  const f = (x: number) => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * SQ2PI)
  const lo = mu - SPAN * sd
  const hi = mu + SPAN * sd
  return { c, f, xs: linspace(lo, hi, 161), lo, hi, mode: mu, peak: f(mu) }
}

/**
 * Density of the read-back concentration on x ≥ 0 (exact change of variables where the curve is monotone; flat
 * parts give 0). `view` is the visible concentration window, so skewed tails inside it are drawn.
 */
export function concDist(m: Pick<Model, 'mean' | 'sd' | 'cMax'>, c: number, view: [number, number]): Dist | null {
  const mu = m.mean(c)
  const sd = m.sd(c)
  if (!Number.isFinite(mu) || !(sd > 0) || !Number.isFinite(sd)) return null
  const scale = Math.max(m.cMax, view[1], 1e-12)
  const h = 1e-6 * scale
  const slope = (x: number) => {
    const a = Math.max(0, x - h)
    const b = x + h
    return (m.mean(b) - m.mean(a)) / (b - a)
  }
  const f = (x: number) => {
    if (!(x >= 0)) return 0
    const y = m.mean(x)
    const d = Math.abs(slope(x))
    return Number.isFinite(y) && Number.isFinite(d) ? (Math.exp(-0.5 * ((y - mu) / sd) ** 2) / (sd * SQ2PI)) * d : 0
  }
  // dense near the level (linearised width), plus the visible window so skewed tails are still drawn
  const s0 = Math.abs(slope(c))
  const w = s0 > 0 ? sd / s0 : scale / 20
  const local = linspace(Math.max(0, c - 8 * w), c + 8 * w, 241)
  const vis = linspace(Math.max(0, view[0]), Math.max(0, view[1]), 400)
  const all = [...new Set([...local, ...vis])].sort((a, b) => a - b)
  const ys = all.map(f)
  let peak = 0
  let mode = c
  ys.forEach((y, i) => {
    if (y > peak) {
      peak = y
      mode = all[i]
    }
  })
  if (!(peak > 0)) return null
  // keep only where the density is visible (plus one point each side so fills close cleanly)
  const keep = ys.map((y) => y > 1e-3 * peak)
  const first = Math.max(0, keep.indexOf(true) - 1)
  const last = Math.min(all.length - 1, keep.lastIndexOf(true) + 1)
  const xs = all.slice(first, last + 1)
  return { c, f, xs, lo: xs[0], hi: xs[xs.length - 1], mode, peak }
}

/** Concentrations a distribution view draws: the levels plus the ruler points. */
export const drawnConcs = (listed: number[], pair: number[] | null) => [...new Set([...listed, ...(pair ?? [])])].sort((a, b) => a - b)

type Lane = 'levels' | 'anchors'

export function buildHistogram(h: HistogramIn): HistSpec {
  const { model: m, pal, series: s, pair, space } = h
  const dist = (c: number) => (space === 'signal' ? signalDist(m, c) : concDist(m, c, h.xRange))
  const span = h.xRange[1] - h.xRange[0]

  // lanes: levels (tested / table levels, readings rug) and anchors (placed or auto-spaced points, blank included)
  const want: { lane: Lane; concs: number[] }[] = []
  if (h.show.levels && h.listed.length) want.push({ lane: 'levels', concs: [...h.listed].sort((a, b) => a - b) })
  if (h.show.anchors && pair && pair.length) want.push({ lane: 'anchors', concs: pair })
  const lanes = want.map((w, i) => ({ ...w, axis: i === 0 ? 'y' : 'y2', dists: w.concs.map(dist) }))
  const top = Math.max(0, ...lanes.flatMap((l) => l.dists.map((d) => (d ? d.peak : 0)))) || 1

  const traces: Data[] = []
  const notes: Record<string, unknown>[] = []
  const targets: HistSpec['targets'] = []

  for (const L of lanes) {
    const n = L.concs.length
    const yr = L.axis
    // readings rug (levels lane only)
    if (L.lane === 'levels' && h.histBars)
      for (const lv of h.dots) {
        const i = L.concs.indexOf(lv.c)
        const vals = space === 'signal' ? lv.ys : lv.ys.map((y) => inverse(m, y)).filter((v): v is number => v !== null)
        if (!vals.length) continue
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: vals,
          y: vals.map(() => 0.035),
          yaxis: yr,
          marker: { symbol: 'line-ns', size: 12, line: { width: 2, color: levelColor(Math.max(i, 0), n, pal.dark, 0.9) } },
          hoverinfo: 'skip',
          cliponaxis: false,
        } as Data)
      }
    // densities
    L.dists.forEach((d, i) => {
      if (!d) return
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: d.xs,
        y: d.xs.map((x) => d.f(x) / top),
        yaxis: yr,
        fill: 'tozeroy',
        fillcolor: levelColor(i, n, pal.dark, 0.07),
        line: { color: levelColor(i, n, pal.dark, 1), width: 1.3 },
        hoverinfo: 'skip',
      } as Data)
      targets.push({ c: d.c, x: d.mode, y: d.peak / top, lane: L.lane, yaxis: yr === 'y' ? 'yaxis' : 'yaxis2' })
    })
    // overlap of adjacent pairs in this lane, coloured by closeness, with a boxed % label
    let lastLabel = -Infinity
    for (let i = 0; i + 1 < n; i++) {
      const a = L.dists[i]
      const b = L.dists[i + 1]
      if (!a || !b) continue
      const lo = Math.max(a.lo, b.lo)
      const hi = Math.min(a.hi, b.hi)
      if (!(hi > lo)) continue
      const xs = [...new Set([...linspace(lo, hi, 161), ...a.xs.filter((x) => x > lo && x < hi), ...b.xs.filter((x) => x > lo && x < hi)])].sort((p, q) => p - q)
      const ys = xs.map((x) => Math.min(a.f(x), b.f(x)) / top)
      const row = pairRow(m, a.c, b.c, s.metric, s.kTarget)
      if (!(row.ovl > 1e-4)) continue
      const q = closenessQ(row, s.metric, s.kTarget)
      const col = closenessColor(q)
      if (col[3] >= 0.02) traces.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, yaxis: yr, fill: 'tozeroy', fillcolor: rgbaCss(col, 1), line: { width: 0 }, hoverinfo: 'skip' } as Data)
      const pk = ys.indexOf(Math.max(...ys))
      if ((row.ovl >= 0.005 && q < 1) || L.lane === 'anchors') {
        if (xs[pk] - lastLabel < 0.05 * span) continue
        lastLabel = xs[pk]
        notes.push({
          x: xs[pk], y: ys[pk], xref: 'x', yref: yr, text: pct(row.ovl),
          showarrow: true, arrowhead: 0, arrowwidth: 0.8, arrowcolor: pal.muted, ax: 0, ay: -20,
          font: { size: 9.5, color: pal.fg }, bgcolor: pal.panel, bordercolor: pal.line, borderwidth: 1, borderpad: 2,
        })
      }
    }
    // concentration labels at peaks (skip when crowded)
    const px: number[] = []
    const py: number[] = []
    const pt: string[] = []
    let lastX = -Infinity
    for (const d of L.dists.filter((z): z is Dist => !!z).sort((a, b) => a.mode - b.mode)) {
      if (d.mode - lastX < 0.035 * span) continue
      lastX = d.mode
      px.push(d.mode)
      py.push(d.peak / top)
      pt.push(fmt(d.c))
    }
    traces.push({ type: 'scatter', mode: 'text', x: px, y: py, yaxis: yr, text: pt, textposition: 'top center', textfont: { size: 9.5, color: pal.muted }, cliponaxis: false, hoverinfo: 'skip' } as Data)
    // lane name
    if (lanes.length > 1 || L.lane === 'anchors')
      notes.push({ xref: 'paper', yref: `${yr} domain`, x: 0, y: 1, xanchor: 'left', yanchor: 'top', text: L.lane === 'anchors' ? 'your concentrations, read back' : 'calibration levels', showarrow: false, font: { size: 10, color: pal.muted } })
  }

  const u = s.units ? ` (${s.units})` : ''
  const title = space === 'signal' ? s.signalLabel || 'Signal' : `Read-back concentration${u}`
  const yax = { range: [0, 1.3], showticklabels: false, showgrid: false, zeroline: false, showline: false, ticks: '', fixedrange: true }
  const two = lanes.length > 1
  const layout: Partial<Layout> = {
    ...baseLayout(pal),
    margin: { ...MARGIN, t: 14, b: 34 },
    annotations: notes as Layout['annotations'],
    hovermode: false,
    modebar: { orientation: 'v' },
    xaxis: { ...axisStyle(pal, title), range: h.xRange, autorange: false } as unknown as Layout['xaxis'],
    yaxis: { ...yax, domain: two ? [0.54, 1] : [0, 1] } as unknown as Layout['yaxis'],
    ...(two ? { yaxis2: { ...yax, domain: [0, 0.44] } as unknown as Layout['yaxis'] } : {}),
    // a thin rule between the lanes
    shapes: two ? ([{ type: 'line', xref: 'paper', yref: 'paper', x0: 0, x1: 1, y0: 0.49, y1: 0.49, line: { color: pal.line, width: 1 } }] as Layout['shapes']) : [],
    uirevision: `h|${space}|${h.xRange[0].toPrecision(4)}|${h.xRange[1].toPrecision(4)}|${h.viewRev}|${lanes.map((l) => l.lane).join(',')}`,
  }
  return { data: traces, layout, targets, top }
}
