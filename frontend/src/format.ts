/** Compact number formatting with `d` significant digits. */
export function fmt(x: number | null | undefined, d = 3): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '–'
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-3) return x.toExponential(d - 1).replace(/\.?0+e/, 'e').replace('e+', 'e')
  if (a >= Math.pow(10, d)) return String(Math.round(x))
  return String(parseFloat(x.toPrecision(d)))
}

export const pct = (x: number): string => {
  if (!Number.isFinite(x)) return '–'
  const v = x * 100
  return `${v < 0.1 && v > 0 ? '<0.1' : v < 10 ? v.toFixed(1) : v.toFixed(0)}%`
}

/** "S 72 → c 2.9 (2.1–3.8)" ; open ends read "< 0.73" (zero not excluded) or "> 160" (above range). */
export function recoveryText(r: { signal: number; c: number | null; lo: number | null; hi: number | null; loOpen: boolean; hiOpen: boolean }, units = ''): string {
  const u = units ? ` ${units}` : ''
  const head = `S ${fmt(r.signal, 4)} →`
  if (r.lo === null || r.hi === null) return `${head} outside the calibrated range`
  if (r.loOpen && r.hiOpen) return `${head} any c (curve too flat here)`
  if (r.loOpen) return `${head} c < ${fmt(r.hi)}${u} · zero not excluded`
  if (r.hiOpen) return `${head} c > ${fmt(r.lo)}${u} · above the calibrated range`
  return `${head} c ${r.c === null ? '?' : fmt(r.c)}${u} (${fmt(r.lo)}–${fmt(r.hi)})`
}
