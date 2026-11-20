import type { MetricKey } from './types'

export type RGBA = [number, number, number, number]

/**
 * Closeness q of an adjacent pair relative to the target: q < 1 = not resolved, q >= 1 = resolved.
 * dsum/ssmd: |value| / k. Z': 1 - 3/x >= k  <=>  dsum >= 3 / (1 - k), so q = |dsum| / (3 / (1 - k)).
 */
export function closenessQ(row: { dsum: number; ssmd: number; zprime: number }, metric: MetricKey, k: number): number {
  let q: number
  if (metric === 'zprime') {
    if (!(k < 1)) q = row.zprime >= k ? 2 : 0
    else q = Math.abs(row.dsum) / (3 / (1 - k))
  } else {
    q = k > 0 ? Math.abs(row[metric]) / k : 2
  }
  return Number.isNaN(q) ? 0 : q
}

const RED: [number, number, number] = [196, 32, 45]
const ORANGE: [number, number, number] = [240, 128, 40]
const YELLOW: [number, number, number] = [244, 196, 62]
const BLUE: [number, number, number] = [64, 132, 205]
const WARM_ALPHA = 0.6
const BLUE_ALPHA = 0.5

const mix = (a: number[], b: number[], t: number): [number, number, number] => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as [number, number, number]

/**
 * One colour language for closeness: q <= 0.25 deep red, 0.6 orange, ->1 yellow; at q >= 1 (resolved)
 * cool blue fading to fully clear by q >= 2.
 */
export function closenessColor(q: number): RGBA {
  if (!(q >= 0)) q = 0
  if (q < 1) {
    const rgb = q <= 0.25 ? RED : q < 0.6 ? mix(RED, ORANGE, (q - 0.25) / 0.35) : mix(ORANGE, YELLOW, (q - 0.6) / 0.4)
    return [...rgb, WARM_ALPHA]
  }
  const a = Number.isFinite(q) ? BLUE_ALPHA * Math.max(0, 2 - q) : 0
  return [...BLUE, a]
}

export const rgbaCss = (c: RGBA, scale = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${+(c[3] * scale).toFixed(3)})`

const TEAL: [number, number, number] = [72, 170, 168]

/**
 * Continuous version of the closeness ramp for backgrounds (no step at q = 1): red (q ≤ 0.25) → orange (0.6) →
 * yellow (1, the edge) → teal (1.5) → blue (≥ 2). Brackets and rows keep the pass/fail ramp of closenessColor.
 */
export function closenessRgbSmooth(q: number): [number, number, number] {
  if (!(q >= 0)) q = 0
  if (q <= 0.25) return RED
  if (q < 0.6) return mix(RED, ORANGE, (q - 0.25) / 0.35)
  if (q < 1) return mix(ORANGE, YELLOW, (q - 0.6) / 0.4)
  if (q < 1.5) return mix(YELLOW, TEAL, (q - 1) / 0.5)
  if (q < 2) return mix(TEAL, BLUE, (q - 1.5) / 0.5)
  return BLUE
}
