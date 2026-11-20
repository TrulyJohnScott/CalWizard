import type { Data, Layout } from 'plotly.js'
import { fmt, recoveryText } from '../format'
import { pairRow, recover, resolutionProfile } from '../math/analysis'
import { closenessColor, closenessQ, rgbaCss } from '../math/closeness'
import { METRIC_LABEL } from '../math/metrics'
import { heatImage, type HeatImage } from '../math/heat'
import type { Model } from '../math/model'
import { hashUnit, type LevelDots } from '../math/sim'
import type { Series } from '../math/types'
import { rulerPoints, type Measure } from '../state/store'
import { levelColor, withAlpha, type Palette } from '../theme'
import { axisStyle, baseLayout, concRange, linspace, MARGIN, nn } from './common'
import type { PlotSpec } from './usePlot'

export interface CalibrationIn {
  series: Series
  model: Model
  dots: LevelDots[]
  /** levels drawn as markers on the curve (the sidebar list) */
  listed: number[]
  flip: boolean
  shading: 'band' | 'heat' | 'lines'
  jitter: number
  measure: Measure | null
  /** hovered concentration while only one ruler point is placed (live preview of the next) */
  live: number | null
  range: [number, number]
  /** zoomed concentration window, or null */
  focus: [number, number] | null
  /** bumps on a view reset (double-click) so Plotly re-applies the computed ranges */
  viewRev: number
  /** recovery signal line, or null */
  reading: number | null
  /** hovered concentration (hover Gaussian + guide lines), or null */
  probe: number | null
  /** draw each level's Gaussian sideways on the curve */
  onCurve: boolean
  /** the headline ladder: faint ticks on the concentration axis */
  ladderTicks: number[]
  /** hovered fit drawn dashed: a mean curve, or ±2σ edges of the current mean with a new sd(S) */
  ghost: { mean?: (c: number) => number; sd?: (S: number) => number } | null
  /** simulated experiment: this run's estimated mean per concentration (short dashes), or null */
  estimates: { c: number; mean: number }[] | null
  pal: Palette
}

const heatMemo = new WeakMap<object, { k: string; img: HeatImage }>()

export function buildCalibration(x: CalibrationIn): PlotSpec {
  const { series: s, model: m, flip, pal } = x
  const [sLo, sHi] = x.range
  // dense grid inside the zoom window so the curve stays smooth when zoomed in
  const cr = concRange(m.cMax, x.focus)
  const cEnd = Math.max(m.cMax, cr[1])
  const grid = [...new Set([...linspace(0, cEnd, 360), ...(x.focus ? linspace(Math.max(0, x.focus[0]), x.focus[1], 240) : [])])].sort((a, b) => a - b)
  const mu = grid.map((c) => m.mean(c))
  const sd = grid.map((c) => m.sd(c))
  const xy = (c: (number | null)[], sig: (number | null)[]) => (flip ? { x: sig, y: c } : { x: c, y: sig })
  const traces: Data[] = []
  const shapes: Partial<Layout['shapes'][number]>[] = []
  const notes: Partial<Layout['annotations'][number]>[] = []

  // background colour (haze / wash / lines) = local resolution at each concentration: intrinsic to the curve, SD,
  // metric and k, independent of placed points (spec §11 v2.7). Brackets and the sidebar stay pair-specific.
  const prof = resolutionProfile(m, s.metric, s.kTarget, cEnd)
  const resColourAt = (c: number): [number, number, number] => {
    const i = Math.min(prof.c.length - 1, Math.max(0, Math.round((c / cEnd) * (prof.c.length - 1))))
    const col = closenessColor(prof.q[i])
    return [col[0], col[1], col[2]]
  }
  const SEG = linspace(0, cEnd, 41)

  if (x.shading === 'lines') {
    // Bollinger-style: ±1σ solid, ±2σ dashed, ±3σ dotted; each stretch coloured by its pair's closeness, neutral beyond
    const stretches = SEG.slice(1).map((b, i) => ({ a: SEG[i], b, rgb: resColourAt(0.5 * (SEG[i] + b)) }))
    const styles = [
      { k: 1, dash: 'solid', width: 1.6, alpha: 0.95 },
      { k: 2, dash: 'dash', width: 1.1, alpha: 0.75 },
      { k: 3, dash: 'dot', width: 1, alpha: 0.6 },
    ] as const
    for (const st of stretches) {
      const cs = linspace(st.a, st.b, 10)
      const colr = `rgba(${st.rgb[0]},${st.rgb[1]},${st.rgb[2]},`
      for (const sty of styles)
        for (const sign of [1, -1])
          traces.push({
            type: 'scatter',
            mode: 'lines',
            ...xy(cs, cs.map((c) => nn(m.mean(c) + sign * sty.k * m.sd(c)))),
            line: { color: `${colr}${sty.alpha})`, width: sty.width, dash: sty.dash },
            hoverinfo: 'skip',
          } as Data)
    }
  } else if (x.shading === 'heat') {
    const hk = `${flip}|${sLo}|${sHi}|${cEnd}|${s.metric}|${s.kTarget}`
    let hm = heatMemo.get(m)
    if (!hm || hm.k !== hk) {
      hm = { k: hk, img: heatImage(m, { space: flip ? 's2c' : 'c2s', cMax: cEnd, sLo, sHi, nc: 400, ns: 260 }, resColourAt) }
      heatMemo.set(m, hm)
    }
    const img = hm.img
    traces.push({ type: 'image', colormodel: 'rgba', z: img.z, x0: img.x0, dx: img.dx, y0: img.y0, dy: img.dy, hoverinfo: 'skip' } as unknown as Data)
  } else {
    // coloured ±2σ wash + ±1σ ribbon in short segments, each in the local-resolution colour
    SEG.slice(1).forEach((b, si) => {
      const a = SEG[si]
      const rgb = resColourAt(0.5 * (a + b))
      const col: [number, number, number, number] = [rgb[0], rgb[1], rgb[2], 0.6]
      const cs = linspace(a, b, 8)
      const up = cs.map((c) => m.mean(c) + 2 * m.sd(c))
      const dn = cs.map((c) => m.mean(c) - 2 * m.sd(c))
      const cc = [...cs, ...cs.slice().reverse(), cs[0]]
      const sg = [...up, ...dn.slice().reverse(), up[0]].map(nn)
      const up1 = cs.map((c) => m.mean(c) + m.sd(c))
      const dn1 = cs.map((c) => m.mean(c) - m.sd(c))
      const s1 = [...up1, ...dn1.slice().reverse(), up1[0]].map(nn)
      traces.push({ type: 'scatter', mode: 'lines', ...xy(cc, sg), line: { width: 0 }, fill: 'toself', fillcolor: rgbaCss(col, 0.18), hoverinfo: 'skip' } as Data)
      traces.push({ type: 'scatter', mode: 'lines', ...xy(cc, s1), line: { width: 0 }, fill: 'toself', fillcolor: rgbaCss(col, 0.6), hoverinfo: 'skip' } as Data)
    })
  }

  // mean curve
  const u = s.units ? ` ${s.units}` : ''
  traces.push({
    type: 'scatter',
    mode: 'lines',
    ...xy(grid, mu.map(nn)),
    line: { color: pal.accent, width: 1.8 },
    text: grid.map((c, i) => `c ${fmt(c)}${u}<br>${s.signalLabel || 'Signal'} ${fmt(mu[i], 4)}<br>SD ${fmt(sd[i])} · CV ${fmt((100 * sd[i]) / Math.abs(mu[i]), 2)}%`),
    hovertemplate: '%{text}<extra></extra>',
  } as Data)

  // replicate dots: horizontal (concentration-direction) jitter, visual only
  const levels = x.listed
  const gaps = levels.slice(1).map((c, i) => c - levels[i]).filter((g) => g > 0)
  const unit = ((x.jitter / 100) * (gaps.length ? Math.min(...gaps) : m.cMax / 10)) || 0
  const dc: number[] = []
  const dy: number[] = []
  const col: string[] = []
  const sym: string[] = []
  const hollow = s.mode !== 'equations' // in table modes, simulated draws (extra levels) are hollow; data filled
  let k = 0
  const idxOf = (c: number) => {
    let best = 0
    let bd = Infinity
    levels.forEach((l, i) => {
      const d = Math.abs(l - c)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }
  for (const lv of x.dots) {
    const cc = levels.length ? levelColor(idxOf(lv.c), levels.length, pal.dark, 0.8) : withAlpha(pal.accent, 0.7)
    for (const y of lv.ys) {
      dc.push(lv.c + hashUnit(k++) * unit)
      dy.push(y)
      col.push(cc)
      sym.push(hollow && lv.sim ? 'circle-open' : 'circle')
    }
  }
  if (dy.length)
    traces.push({ type: 'scatter', mode: 'markers', ...xy(dc, dy), marker: { size: 5, color: col, symbol: sym, line: { width: 1.2, color: col } }, hoverinfo: 'skip' } as Data)

  // sideways Gaussians on the curve: each level's signal spread, drawn out from its concentration. True density
  // (tight = wide bump, noisy = narrow-and-long), the tightest drawn one spanning GW of the concentration axis.
  const span = cr[1] - cr[0]
  const GW = 0.07 * span
  const gauss = (c: number) => {
    const mu = m.mean(c)
    const sd = m.sd(c)
    return Number.isFinite(mu) && sd > 0 && Number.isFinite(sd) ? { mu, sd } : null
  }
  const drawn = [...levels, ...(x.probe !== null ? [x.probe] : [])].map(gauss)
  const sdRef = Math.min(...drawn.filter((g): g is { mu: number; sd: number } => !!g).map((g) => g.sd), Infinity)
  const bump = (c: number, g: { mu: number; sd: number }) => {
    const ys = linspace(g.mu - 3.5 * g.sd, g.mu + 3.5 * g.sd, 71)
    const w = GW * (sdRef / g.sd)
    const cs = ys.map((y) => c + w * Math.exp(-0.5 * ((y - g.mu) / g.sd) ** 2))
    return { cs: [c, ...cs, c], ys: [ys[0], ...ys, ys[ys.length - 1]] }
  }
  if (x.onCurve && Number.isFinite(sdRef))
    levels.forEach((c, i) => {
      const g = gauss(c)
      if (!g) return
      const b = bump(c, g)
      traces.push({
        type: 'scatter',
        mode: 'lines',
        ...xy(b.cs, b.ys),
        fill: 'toself',
        fillcolor: levelColor(i, levels.length, pal.dark, 0.1),
        line: { color: levelColor(i, levels.length, pal.dark, 0.85), width: 1.1 },
        hoverinfo: 'skip',
      } as Data)
      // ±1 SD marked on the bump (the bump itself is drawn out to ±3.5 SD, so it looks much wider than the SD)
      const w1 = GW * (sdRef / g.sd) * Math.exp(-0.5)
      traces.push({
        type: 'scatter',
        mode: 'markers',
        ...xy([c + w1, c + w1], [g.mu - g.sd, g.mu + g.sd]),
        marker: { size: 4.5, color: levelColor(i, levels.length, pal.dark, 1) },
        hovertemplate: `±1 SD: ${fmt(g.mu - g.sd, 4)} – ${fmt(g.mu + g.sd, 4)} (SD ${fmt(g.sd, 3)})<extra></extra>`,
      } as Data)
    })

  // hover: dashed Gaussian at the hovered concentration + guide lines from both axes to the curve
  if (x.probe !== null) {
    const c = x.probe
    const g = gauss(c)
    if (g) {
      const guide = { color: pal.muted, width: 1, dash: 'dot' as const }
      // concentration guide from the c axis up to the curve; signal guide from the signal axis across to it
      shapes.push(
        flip
          ? { type: 'line', xref: 'x', yref: 'y', x0: sLo, x1: g.mu, y0: c, y1: c, line: guide }
          : { type: 'line', xref: 'x', yref: 'y', x0: c, x1: c, y0: sLo, y1: g.mu, line: guide },
        flip
          ? { type: 'line', xref: 'x', yref: 'y', x0: g.mu, x1: g.mu, y0: cr[0], y1: c, line: guide }
          : { type: 'line', xref: 'x', yref: 'y', x0: cr[0], x1: c, y0: g.mu, y1: g.mu, line: guide },
      )
      if (Number.isFinite(sdRef)) {
        const b = bump(c, g)
        traces.push({ type: 'scatter', mode: 'lines', ...xy(b.cs, b.ys), line: { color: pal.fg, width: 1.1, dash: 'dash' }, hoverinfo: 'skip' } as Data)
      }
    }
  }

  // resolvable ladder as faint ticks just inside the concentration axis (Shift-click near one adds it)

  // resolvable ladder as faint ticks just inside the concentration axis
  for (const c of x.ladderTicks) {
    const tick = { color: withAlpha(pal.accent, 0.55), width: 1.5 }
    shapes.push(flip ? { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 0.018, y0: c, y1: c, line: tick } : { type: 'line', xref: 'x', yref: 'paper', x0: c, x1: c, y0: 0, y1: 0.03, line: tick })
  }

  // hovered fit (ghost): dashed preview before applying
  if (x.ghost) {
    const g = x.ghost
    const dash = { color: pal.fg, width: 1.6, dash: 'dash' as const }
    if (g.mean) traces.push({ type: 'scatter', mode: 'lines', ...xy(grid, grid.map((c) => nn(g.mean!(c)))), line: dash, hoverinfo: 'skip' } as Data)
    if (g.sd)
      for (const sign of [1, -1])
        traces.push({ type: 'scatter', mode: 'lines', ...xy(grid, mu.map((v) => nn(v + sign * 2 * g.sd!(v)))), line: { ...dash, width: 1.2 }, hoverinfo: 'skip' } as Data)
  }

  // experiment: this run's estimated means as short dashes across each level's dots
  if (x.estimates?.length)
    traces.push({
      type: 'scatter',
      mode: 'markers',
      ...xy(x.estimates.map((e) => e.c), x.estimates.map((e) => e.mean)),
      marker: { symbol: flip ? 'line-ns' : 'line-ew', size: 16, line: { width: 2.2, color: pal.fg } },
      hoverinfo: 'skip',
    } as Data)

  // level markers on the curve
  if (levels.length)
    traces.push({
      type: 'scatter',
      mode: 'markers',
      ...xy(levels, levels.map((c) => nn(m.mean(c)))),
      marker: { size: 8, color: pal.panel, line: { width: 1.6, color: levels.map((_, i) => levelColor(i, levels.length, pal.dark)) } },
      text: levels.map((c) => `c ${fmt(c)}${u}<br>mean ${fmt(m.mean(c), 4)} · SD ${fmt(m.sd(c))}`),
      hovertemplate: '%{text}<extra></extra>',
    } as Data)

  // ruler: open handles on the curve; every adjacent pair gets a bracket coloured by its closeness, labelled with
  // its metric value (the second point is previewed live while only one is placed)
  if (x.measure) {
    const cs = rulerPoints(x.measure, x.live)
    traces.push({
      type: 'scatter',
      mode: 'markers',
      ...xy(cs, cs.map((c) => nn(m.mean(c)))),
      marker: { size: 9, color: pal.fg, symbol: 'circle-open', line: { width: 1.6, color: pal.fg } },
      hoverinfo: 'skip',
    } as Data)
    const sel = x.measure.sel
    if (sel !== null && sel !== undefined && x.measure.pts[sel] !== undefined) {
      const c = x.measure.pts[sel]
      traces.push({
        type: 'scatter',
        mode: 'markers',
        ...xy([c], [nn(m.mean(c))]),
        marker: { size: 15, color: withAlpha(pal.accent, 0.25), line: { width: 2, color: pal.accent } },
        hovertemplate: `selected anchor c ${fmt(c)} · drag to move · Delete to remove<extra></extra>`,
      } as Data)
    }
    for (let i = 0; i + 1 < cs.length; i++) {
      const [c1, c2] = [cs[i], cs[i + 1]]
      const [m1, m2] = [m.mean(c1), m.mean(c2)]
      const off = 0.04 * (sHi - sLo) * (m2 >= m1 ? -1 : 1)
      const row = pairRow(m, c1, c2, s.metric, s.kTarget)
      const col = closenessColor(closenessQ(row, s.metric, s.kTarget))
      const mid = 0.5 * (c1 + c2)
      notes.push({
        ...(flip ? { x: 0.5 * (m1 + m2) + off, y: mid, xanchor: off < 0 ? 'right' : 'left' } : { x: mid, y: 0.5 * (m1 + m2) + off, yanchor: off < 0 ? 'top' : 'bottom' }),
        xref: 'x',
        yref: 'y',
        text: cs.length > 2 ? fmt(row[s.metric]) : `${METRIC_LABEL[s.metric]} ${fmt(row[s.metric])}`,
        showarrow: false,
        font: { size: 11, color: rgbaCss([col[0], col[1], col[2], 1]) },
        bgcolor: pal.panel,
        borderpad: 2,
      } as Partial<Layout['annotations'][number]>)
      traces.push({
        type: 'scatter',
        mode: 'lines',
        ...xy([c1, c1, c2, c2], [m1, m1 + off, m2 + off, m2]),
        line: { color: rgbaCss([col[0], col[1], col[2], 1]), width: 2 },
        hoverinfo: 'skip',
      } as Data)
    }
  }

  // recovery: signal line, read-back point, and the consistent concentration range shaded on the c axis
  if (x.reading !== null) {
    const S = x.reading
    const r = recover(m, S)
    const line = { color: pal.fg, width: 1.2, dash: 'dash' as const }
    shapes.push(flip ? { type: 'line', xref: 'x', yref: 'paper', x0: S, x1: S, y0: 0, y1: 1, line } : { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: S, y1: S, line })
    if (r.lo !== null && r.hi !== null) {
      const fill = withAlpha(pal.accent, 0.1)
      shapes.push(
        flip
          ? { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: r.lo, y1: r.hi, fillcolor: fill, line: { width: 0 }, layer: 'below' }
          : { type: 'rect', xref: 'x', yref: 'paper', x0: r.lo, x1: r.hi, y0: 0, y1: 1, fillcolor: fill, line: { width: 0 }, layer: 'below' },
      )
    }
    if (r.c !== null) traces.push({ type: 'scatter', mode: 'markers', ...xy([r.c], [S]), marker: { size: 9, color: pal.fg }, hoverinfo: 'skip' } as Data)
    notes.push(
      flip
        ? { xref: 'x', yref: 'paper', x: S, y: 1, yanchor: 'top', xanchor: 'left', xshift: 4, text: recoveryText(r, s.units), showarrow: false, font: { size: 11, color: pal.fg }, bgcolor: pal.panel, borderpad: 3 }
        : { xref: 'paper', yref: 'y', x: 1, y: S, xanchor: 'right', yanchor: 'bottom', yshift: 2, text: recoveryText(r, s.units), showarrow: false, font: { size: 11, color: pal.fg }, bgcolor: pal.panel, borderpad: 3 },
    )
  }

  const cAxis = { ...axisStyle(pal, `Concentration${s.units ? ` (${s.units})` : ''}`), range: cr, autorange: false }
  const sAxis = { ...axisStyle(pal, s.signalLabel || 'Signal'), range: [sLo, sHi], autorange: false }
  const layout: Partial<Layout> = {
    ...baseLayout(pal),
    margin: { ...MARGIN, t: 10, b: 40 },
    hovermode: 'closest',
    modebar: { orientation: 'v' },
    shapes: shapes as Layout['shapes'],
    annotations: notes as Layout['annotations'],
    xaxis: { ...(flip ? sAxis : cAxis), constrain: 'range', scaleanchor: false } as unknown as Layout['xaxis'],
    yaxis: { ...(flip ? cAxis : sAxis), constrain: 'range', scaleanchor: false } as unknown as Layout['yaxis'],
    uirevision: `${x.focus?.join('-') ?? 'all'}|${flip}|${m.cMax}|${sLo.toPrecision(4)}|${sHi.toPrecision(4)}|${x.shading}|${x.viewRev}`,
  }
  return { data: traces, layout, animateKey: flip ? 's2c' : 'c2s' }
}
