import type { Model } from './model'
import { replicateStats } from './tables'
import type { Series } from './types'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeNormal(rand: () => number): () => number {
  return () => {
    const u1 = Math.max(rand(), 1e-300)
    const u2 = rand()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }
}

/** Deterministic value in [-1, 1] for point index i (visual jitter). */
export function hashUnit(i: number): number {
  return mulberry32(i * 2654435761 + 12345)() * 2 - 1
}

export interface LevelDots {
  c: number
  ys: number[]
  /** simulated draws (not entered data): drawn hollow */
  sim?: boolean
}

/** Spec section 7: replicate dots per level (entered data, or simulated N(mean, sd) draws). */
export function levelDots(s: Series, m: Model): LevelDots[] {
  const z = makeNormal(mulberry32(s.sim.seed))
  const n = Math.max(0, Math.floor(s.sim.n))
  const draw = (c: number): LevelDots => {
    const mu = m.mean(c)
    const sd = m.sd(c)
    const ys: number[] = []
    for (let i = 0; i < n; i++) ys.push(mu + sd * z())
    return { c, ys, sim: true }
  }
  if (s.mode === 'replicates') {
    const data = replicateStats(s.replicates).map((p) => ({ c: p.c, ys: p.ys }))
    const have = new Set(data.map((d) => d.c))
    const extra = (s.extraLevels ?? []).filter((c) => !have.has(c)).map(draw)
    return [...data, ...extra].sort((a, b) => a.c - b.c)
  }
  return m.levels.map(draw)
}
