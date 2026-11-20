import { ovlErr } from './metrics'
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
  cMax: number
  sLo: number
  sHi: number
  nc: number
  ns: number
  /** step ratio r: colour = overlap of level c with level r*c */
  r: number
}

/** Local overlap between N(mean(c), sd(c)) and N(mean(r c), sd(r c)); c = 0 uses the first positive level. */
export function localOverlap(m: Model, c: number, r: number): number {
  let c2: number
  if (c <= 0) c2 = m.levels.find((l) => l > 0) ?? m.cMax / 100
  else {
    c2 = c * r
    if (c2 > m.cMax && !m.extrapolates) c2 = c / r
  }
  return ovlErr(m.mean(c), m.sd(c), m.mean(c2), m.sd(c2)).ovl
}

/** Heat cloud on linear axes: opacity = Normal density around mean(c), colour = local overlap. */
export function heatImage(m: Model, h: HeatSpec, rgb: (t: number) => [number, number, number]): HeatImage {
  const dc = h.cMax / h.nc
  const ds = (h.sHi - h.sLo) / h.ns
  const mu: number[] = []
  const sd: number[] = []
  const col: [number, number, number][] = []
  for (let k = 0; k < h.nc; k++) {
    const c = (k + 0.5) * dc
    mu.push(m.mean(c))
    sd.push(m.sd(c))
    col.push(rgb(localOverlap(m, c, h.r)))
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
