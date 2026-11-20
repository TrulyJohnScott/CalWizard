import type { Model } from './model'

export interface HeatImage {
  /** z[row][col] = [r,g,b,a], r,g,b 0..255 and a 0..1 (Plotly image trace, colormodel rgba) */
  z: number[][][]
  x0: number
  dx: number
  y0: number
  dy: number
}

const MAX_ALPHA = 0.8
const CUT = 3.2 // fade to nothing beyond this many SD

export interface HeatSpec {
  /** 'c2s': x = concentration, y = signal. 's2c': x = signal, y = concentration. */
  space: 'c2s' | 's2c'
  /** concentration range drawn: [0, cEnd] */
  cMax: number
  sLo: number
  sHi: number
  nc: number
  ns: number
}

/**
 * Heat cloud on linear axes: opacity = Normal density around mean(c); colour = colourAt(c), the closeness of the
 * neighbouring pair c lies between (spec §11 v2.6: one colour language for haze, brackets and sidebar).
 */
export function heatImage(m: Model, h: HeatSpec, colourAt: (c: number) => [number, number, number]): HeatImage {
  const dc = h.cMax / h.nc
  const ds = (h.sHi - h.sLo) / h.ns
  const mu: number[] = []
  const sd: number[] = []
  const col: [number, number, number][] = []
  for (let k = 0; k < h.nc; k++) {
    const c = (k + 0.5) * dc
    mu.push(m.mean(c))
    sd.push(m.sd(c))
    col.push(colourAt(c))
  }
  const pixel = (kc: number, ks: number): number[] => {
    const s = h.sLo + (ks + 0.5) * ds
    const zz = (s - mu[kc]) / sd[kc]
    if (!Number.isFinite(zz) || Math.abs(zz) > CUT) return [0, 0, 0, 0]
    const [r, g, b] = col[kc]
    return [r, g, b, +(MAX_ALPHA * Math.exp(-0.5 * zz * zz)).toFixed(3)]
  }
  const z: number[][][] = []
  if (h.space === 'c2s') {
    for (let i = 0; i < h.ns; i++) {
      const row: number[][] = []
      for (let j = 0; j < h.nc; j++) row.push(pixel(j, i))
      z.push(row)
    }
    return { z, x0: dc / 2, dx: dc, y0: h.sLo + ds / 2, dy: ds }
  }
  for (let i = 0; i < h.nc; i++) {
    const row: number[][] = []
    for (let j = 0; j < h.ns; j++) row.push(pixel(i, j))
    z.push(row)
  }
  return { z, x0: h.sLo + ds / 2, dx: ds, y0: dc / 2, dy: dc }
}
