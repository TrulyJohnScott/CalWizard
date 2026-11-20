/** PCHIP derivative estimates matching scipy.interpolate.PchipInterpolator. */
function pchipSlopes(x: number[], y: number[]): number[] {
  const n = x.length
  const h: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h.push(x[i + 1] - x[i])
    m.push((y[i + 1] - y[i]) / h[i])
  }
  if (n === 2) return [m[0], m[0]]
  const d = new Array<number>(n).fill(0)
  for (let k = 1; k < n - 1; k++) {
    if (m[k - 1] * m[k] > 0) {
      const w1 = 2 * h[k] + h[k - 1]
      const w2 = h[k] + 2 * h[k - 1]
      d[k] = (w1 + w2) / (w1 / m[k - 1] + w2 / m[k])
    }
  }
  const edge = (h0: number, h1: number, m0: number, m1: number) => {
    let e = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1)
    if (Math.sign(e) !== Math.sign(m0)) e = 0
    else if (Math.sign(m0) !== Math.sign(m1) && Math.abs(e) > 3 * Math.abs(m0)) e = 3 * m0
    return e
  }
  d[0] = edge(h[0], h[1], m[0], m[1])
  d[n - 1] = edge(h[n - 2], h[n - 3], m[n - 2], m[n - 3])
  return d
}

/** Sort by c and average duplicates. Non-finite points are dropped. */
export function mergePoints(points: [number, number][]): [number, number][] {
  const groups = new Map<number, number[]>()
  for (const [c, y] of points) {
    if (!Number.isFinite(c) || !Number.isFinite(y)) continue
    const g = groups.get(c)
    if (g) g.push(y)
    else groups.set(c, [y])
  }
  return [...groups.entries()]
    .map(([c, v]): [number, number] => [c, v.reduce((s, x) => s + x, 0) / v.length])
    .sort((a, b) => a[0] - b[0])
}

/**
 * Spec section 3: PCHIP on linear c; 1 point = constant, 2 points = linear. Held flat below the first point; above
 * the last point held flat, or with `extend` continued as a straight line with the PCHIP end slope.
 */
export function makeInterp(points: [number, number][], extend = false): (c: number) => number {
  const pts = mergePoints(points)
  const n = pts.length
  if (n === 0) return () => NaN
  if (n === 1) return () => pts[0][1]
  const x = pts.map((p) => p[0])
  const y = pts.map((p) => p[1])
  const d = pchipSlopes(x, y)
  return (c: number) => {
    if (Number.isNaN(c)) return NaN
    if (c <= x[0]) return y[0]
    if (c >= x[n - 1]) return y[n - 1] + (extend ? d[n - 1] * (c - x[n - 1]) : 0)
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (x[mid] <= c) lo = mid
      else hi = mid
    }
    const h = x[hi] - x[lo]
    const s = (c - x[lo]) / h
    const s2 = s * s
    const s3 = s2 * s
    return (2 * s3 - 3 * s2 + 1) * y[lo] + (s3 - 2 * s2 + s) * h * d[lo] + (-2 * s3 + 3 * s2) * y[hi] + (s3 - s2) * h * d[hi]
  }
}
