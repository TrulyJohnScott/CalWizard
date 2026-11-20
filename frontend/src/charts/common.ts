import type { Layout } from 'plotly.js'
import type { Model } from '../math/model'
import type { LevelDots } from '../math/sim'
import type { Palette } from '../theme'

/** Same left/right margins in both charts so plot areas line up. */
export const MARGIN = { l: 58, r: 14 }

export function axisStyle(pal: Palette, title?: string) {
  return {
    title: title ? { text: title, font: { size: 11, color: pal.muted }, standoff: 6 } : undefined,
    showline: true,
    linecolor: pal.line,
    linewidth: 1,
    gridcolor: pal.grid,
    gridwidth: 1,
    zeroline: false,
    ticks: 'outside' as const,
    ticklen: 3,
    tickcolor: pal.line,
    tickfont: { size: 10.5, color: pal.muted },
    tickformat: '~g',
    automargin: false,
    fixedrange: false,
  }
}

export function baseLayout(pal: Palette): Partial<Layout> {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: pal.font, size: 11, color: pal.fg },
    showlegend: false,
    hoverlabel: { bgcolor: pal.panel, bordercolor: pal.line, font: { size: 11, color: pal.fg, family: pal.font }, align: 'left' },
    dragmode: 'zoom',
  }
}

/**
 * Signal range covering mean +/- 2 SD (3 SD when zoomed) over the concentration window
 * ([0, cMax] by default) and every dot inside it.
 */
export function signalRange(m: Model, dots: LevelDots[], win: [number, number] | null = null): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  const N = 120
  const [a, b] = win ?? [0, m.cMax]
  const k = win ? 3 : 2
  for (let i = 0; i <= N; i++) {
    const c = a + ((b - a) * i) / N
    const mu = m.mean(c)
    const s = m.sd(c)
    if (!Number.isFinite(mu)) continue
    const w = Number.isFinite(s) ? k * s : 0
    lo = Math.min(lo, mu - w)
    hi = Math.max(hi, mu + w)
  }
  for (const l of dots) {
    if (l.c < a || l.c > b) continue
    for (const y of l.ys) {
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  if (hi - lo < 1e-9) return [lo - 1, hi + 1]
  const pad = 0.04 * (hi - lo)
  return [lo - pad, hi + pad]
}

/** Concentration-axis range shared by the scatter (c axis) and the read-back histogram. */
export function concRange(cMax: number, focus: [number, number] | null): [number, number] {
  if (focus) {
    const pad = 0.03 * (focus[1] - focus[0])
    return [focus[0] - pad, focus[1] + pad]
  }
  return [-0.02 * cMax, 1.02 * cMax]
}

export const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))

export const gauss = (x: number, mu: number, sd: number) => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))

/** NaN/inf -> null so Plotly breaks the line. */
export const nn = (v: number): number | null => (Number.isFinite(v) ? v : null)
