/**
 * Spec §15.4: curve direction and the high-dose hook. Port of Model.direction / Model.hook / Model.c_top in
 * backend/app/series.py. Cached per mean function (a compiled curve and its scaled views share it).
 */
const SCAN = 2001

type Curve = { mean: (c: number) => number; cMax: number }
export interface Hook {
  c: number
  signal: number
}

const dirCache = new WeakMap<object, Map<number, 1 | -1>>()
const hookCache = new WeakMap<object, Map<number, Hook | null>>()

function cached<T>(store: WeakMap<object, Map<number, T>>, m: Curve, make: () => T): T {
  let byMax = store.get(m.mean)
  if (!byMax) store.set(m.mean, (byMax = new Map()))
  if (!byMax.has(m.cMax)) byMax.set(m.cMax, make())
  return byMax.get(m.cMax) as T
}

/** +1 when the signal rises with concentration, −1 when it falls: the sign of the largest excursion from the blank. */
export const directionOf = (m: Curve): 1 | -1 =>
  cached(dirCache, m, () => {
    const m0 = m.mean(0)
    let best = 0
    for (let j = 0; j < SCAN; j++) {
      const v = m.mean((m.cMax * j) / (SCAN - 1)) - m0
      if (Number.isFinite(v) && Math.abs(v) > Math.abs(best)) best = v
    }
    return best >= 0 ? 1 : -1
  })

/** The hook's peak {c, signal} when direction·mean turns back inside [0, cMax] (by > 1e-6 of the span), else null. */
export const hookOf = (m: Curve): Hook | null =>
  cached(hookCache, m, () => {
    const d = directionOf(m)
    const cs: number[] = []
    const y: number[] = []
    for (let j = 0; j < SCAN; j++) {
      const c = (m.cMax * j) / (SCAN - 1)
      cs.push(c)
      y.push(d * m.mean(c))
    }
    if (!y.every(Number.isFinite)) return null
    let i = 0
    for (let j = 1; j < SCAN; j++) if (y[j] > y[i]) i = j
    const span = Math.max(...y) - Math.min(...y)
    if (!(i < SCAN - 1 && span > 0 && y[i] - y[SCAN - 1] > 1e-6 * span)) return null
    let a = cs[Math.max(i - 1, 0)]
    let b = cs[i + 1]
    const g = (Math.sqrt(5) - 1) / 2
    for (let k = 0; k < 60; k++) {
      const x1 = b - g * (b - a)
      const x2 = a + g * (b - a)
      if (d * m.mean(x1) >= d * m.mean(x2)) b = x2
      else a = x1
    }
    const c = 0.5 * (a + b)
    return { c, signal: m.mean(c) }
  })

/** Top of the usable range: the hook's peak, else cMax. */
export const cTop = (m: Curve): number => hookOf(m)?.c ?? m.cMax
