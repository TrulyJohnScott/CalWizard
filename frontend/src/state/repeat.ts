/**
 * Repeat the experiment (core design): treat the curve as the truth, draw `n` strips at each concentration, average
 * them and rebuild the calibration from those means (straight lines between them, as a lab interpolates). Each run is
 * one curve; together they show how much a single calibration could differ by chance.
 */
import { makeNormal, mulberry32 } from '../math/sim'
import type { Model } from '../math/model'

export interface RepeatResult {
  concs: number[]
  /** one array of mean signals per run, aligned with concs */
  runs: number[][]
  /** a reading at the true signal of `at`, read back on each run's curve: 5th and 95th percentile */
  at: number | null
  back: [number, number] | null
}

/** Read a signal back on a piecewise-linear curve through (concs, ys); null outside it. */
function invertLinear(concs: number[], ys: number[], S: number): number | null {
  for (let i = 1; i < concs.length; i++) {
    const a = ys[i - 1]
    const b = ys[i]
    if ((S - a) * (S - b) <= 0 && a !== b) return concs[i - 1] + ((S - a) / (b - a)) * (concs[i] - concs[i - 1])
  }
  return null
}

const quantile = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b)
  const x = p * (s.length - 1)
  const i = Math.floor(x)
  return i + 1 < s.length ? s[i] + (x - i) * (s[i + 1] - s[i]) : s[i]
}

export function repeatRuns(m: Pick<Model, 'mean' | 'sd'>, concs: number[], n: number, runs: number, at: number | null, seed = 7): RepeatResult {
  const cs = [...new Set(concs.filter((c) => Number.isFinite(c) && c >= 0))].sort((a, b) => a - b)
  const strips = Math.max(1, Math.round(n))
  const norm = makeNormal(mulberry32(seed))
  const out: number[][] = []
  for (let r = 0; r < runs; r++)
    out.push(
      cs.map((c) => {
        let sum = 0
        for (let j = 0; j < strips; j++) sum += m.mean(c) + m.sd(c) * norm()
        return sum / strips
      }),
    )
  let back: [number, number] | null = null
  if (at !== null && runs >= 20) {
    const S = m.mean(at)
    const v = out.map((ys) => invertLinear(cs, ys, S)).filter((x): x is number => x !== null)
    if (v.length >= runs / 2) back = [quantile(v, 0.05), quantile(v, 0.95)]
  }
  return { concs: cs, runs: out, at, back }
}
