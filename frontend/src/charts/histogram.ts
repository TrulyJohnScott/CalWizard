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
  /** measured pair (committed or live), emphasised */
  pair: [number, number] | null
  probe: number | null
  space: HistSpace
  /** the scatter's x range (signal range when `signal`, concentration range when `conc`) */
  xRange: [number, number]
  /** bumps when the user resets the view (double-click) so Plotly re-applies the computed range */
  viewRev: number
  pal: Palette
}

export interface HistSpec extends PlotSpec {
  /** drag handles: each drawn concentration's peak in data coordinates */
  targets: { c: number; x: number; y: number }[]
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

/** Concentrations a distribution view draws: the levels plus the measured pair. */
export const drawnConcs = (listed: number[], pair: [number, number] | null) => [...new Set([...listed, ...(pair ?? [])])].sort((a, b) => a - b)

export function buildHistogram(h: HistogramIn): HistSpec {
  const { model: m, pal, series: s, pair, space } = h
  const concs = drawnConcs(h.listed, pair)
  const emph = (c: number) => !pair || c === pair[0] || c === pair[1]
  const dist = (c: number) => (space === 'signal' ? signalDist(m, c) : concDist(m, c, h.xRange))
  const dists = concs.map(dist)
  const top = Math.max(0, ...dists.map((d) => (d ? d.peak : 0))) || 1
  const traces: Data[] = []

  // histogram bars of replicate dots (off by default), same density scale
  if (h.histBars) {
    for (const lv of h.dots) {
      const i = concs.indexOf(lv.c)
      const d = i >= 0 ? dists[i] : null
      const vals = space === 'signal' ? lv.ys : lv.ys.map((y) => inverse(m, y)).filter((v): v is number => v !== null)
      // bin width ≈ one SD in this space, wider for few readings (n = 3 → 1.15 SD) so bars stay on the curve's scale
      const w = (d ? (d.hi - d.lo) / (2 * SPAN) : (h.xRange[1] - h.xRange[0]) / 40) * Math.max(0.5, 2 / Math.sqrt(vals.length))
      if (!vals.length || !(w > 0)) continue
      const bins = new Map<number, number>()
      for (const v of vals) bins.set(Math.round(v / w), (bins.get(Math.round(v / w)) ?? 0) + 1)
      traces.push({
        type: 'bar',
        x: [...bins.keys()].map((b) => b * w),
        y: [...bins.values()].map((n) => n / (lv.ys.length * w) / top),
        width: w * 0.9,
        marker: { color: levelColor(Math.max(i, 0), concs.length, pal.dark, pair && !emph(lv.c) ? 0.12 : 0.35) },
        hoverinfo: 'skip',
      } as Data)
    }
  }

  // one density per drawn concentration (the measured pair stands out, the rest dim)
  dists.forEach((d, i) => {
    if (!d) return
    const dim = !emph(d.c)
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x: d.xs,
      y: d.xs.map((x) => d.f(x) / top),
      fill: 'tozeroy',
      fillcolor: levelColor(i, dists.length, pal.dark, dim ? 0.02 : 0.07),
      line: { color: levelColor(i, dists.length, pal.dark, dim ? 0.3 : 1), width: dim ? 1 : 1.4 },
      hoverinfo: 'skip',
    } as Data)
  })

  // overlap of adjacent levels (or of the measured pair); the overlap coefficient is the same in both spaces
  const pairs: [Dist, Dist][] = []
  const at = (c: number) => dists[concs.indexOf(c)]
  if (pair) {
    const a = at(pair[0])
    const b = at(pair[1])
    if (a && b) pairs.push([a, b])
  } else
    for (let i = 0; i + 1 < dists.length; i++) {
      const a = dists[i]
      const b = dists[i + 1]
      if (a && b) pairs.push([a, b])
    }
  const labels: { x: number; y: number; text: string }[] = []
  const span = h.xRange[1] - h.xRange[0]
  for (const [a, b] of pairs) {
    const lo = Math.max(a.lo, b.lo)
    const hi = Math.min(a.hi, b.hi)
    if (!(hi > lo)) continue
    const xs = [...new Set([...linspace(lo, hi, 241), ...a.xs.filter((x) => x > lo && x < hi), ...b.xs.filter((x) => x > lo && x < hi)])].sort((p, q) => p - q)
    const ys = xs.map((x) => Math.min(a.f(x), b.f(x)) / top)
    const row = pairRow(m, Math.min(a.c, b.c), Math.max(a.c, b.c), s.metric, s.kTarget)
    if (!(row.ovl > 1e-4)) continue
    const strong = !!pair
    const q = closenessQ(row, s.metric, s.kTarget)
    const col = closenessColor(q)
    if (col[3] >= 0.02)
      traces.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, fill: 'tozeroy', fillcolor: rgbaCss(col, strong ? 1.1 : 0.9), line: { width: 0 }, hoverinfo: 'skip' } as Data)
    if ((row.ovl >= 0.005 && q < 1) || strong) {
      const pk = ys.indexOf(Math.max(...ys))
      if (!strong && labels.length && xs[pk] - labels[labels.length - 1].x < 0.05 * span) continue
      labels.push({ x: xs[pk], y: ys[pk], text: pct(row.ovl) })
    }
  }
  // overlap % labels float above the overlap on a boxed label with a hairline leader
  const overlapLabels = labels.map((l) => ({
    ...l,
    showarrow: true,
    arrowhead: 0,
    arrowwidth: 0.8,
    arrowcolor: pal.muted,
    ax: 0,
    ay: -24,
    font: { size: 9.5, color: pal.fg },
    bgcolor: pal.panel,
    bordercolor: pal.line,
    borderwidth: 1,
    borderpad: 2,
  }))

  // concentration labels at peaks (skip when crowded)
  const px: number[] = []
  const py: number[] = []
  const pt: string[] = []
  let lastX = -Infinity
  for (const d of dists.filter((z): z is Dist => !!z).sort((a, b) => a.mode - b.mode)) {
    if (d.mode - lastX < 0.035 * span && !(pair && emph(d.c))) continue
    lastX = d.mode
    px.push(d.mode)
    py.push(d.peak / top)
    pt.push(fmt(d.c))
  }
  traces.push({ type: 'scatter', mode: 'text', x: px, y: py, text: pt, textposition: 'top center', textfont: { size: 9.5, color: pal.muted }, cliponaxis: false, hoverinfo: 'skip' } as Data)

  // probe: dashed density at the hovered concentration (skipped when it coincides with a drawn one)
  if (h.probe !== null && !concs.includes(h.probe)) {
    const d = dist(h.probe)
    if (d) {
      traces.push({ type: 'scatter', mode: 'lines', x: d.xs, y: d.xs.map((x) => d.f(x) / top), line: { color: pal.fg, width: 1.2, dash: 'dash' }, hoverinfo: 'skip' } as Data)
      traces.push({
        type: 'scatter',
        mode: 'text',
        x: [d.mode],
        y: [Math.min(1.1, d.peak / top)],
        text: [`c ${fmt(h.probe)}`],
        textposition: 'top center',
        textfont: { size: 9.5, color: pal.fg },
        cliponaxis: false,
        hoverinfo: 'skip',
      } as Data)
    }
  }

  const u = s.units ? ` (${s.units})` : ''
  const title = space === 'signal' ? s.signalLabel || 'Signal' : `Read-back concentration${u}`
  const layout: Partial<Layout> = {
    ...baseLayout(pal),
    margin: { ...MARGIN, t: 14, b: 34 },
    annotations: overlapLabels as Layout['annotations'],
    hovermode: false,
    modebar: { orientation: 'v' },
    bargap: 0,
    xaxis: { ...axisStyle(pal, title), range: h.xRange, autorange: false } as unknown as Layout['xaxis'],
    yaxis: { range: [0, 1.25], showticklabels: false, showgrid: false, zeroline: false, showline: false, ticks: '', fixedrange: true } as unknown as Layout['yaxis'],
    uirevision: `h|${space}|${h.xRange[0].toPrecision(4)}|${h.xRange[1].toPrecision(4)}|${h.viewRev}`,
  }
  const targets = concs.flatMap((c, i) => {
    const d = dists[i]
    return d ? [{ c, x: d.mode, y: d.peak / top }] : []
  })
  return { data: traces, layout, targets, top }
}
