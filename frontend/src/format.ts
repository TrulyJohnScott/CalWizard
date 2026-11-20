/** Axis / column title for concentration: "CRP (ng/mL)", "Concentration (ng/mL)", "CRP". */
export function concLabel(s: { analyte?: string; units: string }): string {
  const name = s.analyte?.trim() || 'Concentration'
  return s.units ? `${name} (${s.units})` : name
}

/** "5 ng/mL" (units optional). */
export const withUnits = (x: number | null | undefined, units: string, d = 3): string => `${fmt(x, d)}${units ? ` ${units}` : ''}`

/** A fraction as a percentage with sensible digits: 0.2 -> "20%", 0.1234 -> "12%", 0.0123 -> "1.2%". */
export function pct2(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–'
  const v = x * 100
  if (v === 0) return '0%'
  if (v > 0 && v < 0.001) return '< 0.001%'
  if (v > 99.99 && v <= 100) return v === 100 ? '100%' : '> 99.99%'
  if (v >= 99.9) return `${v.toFixed(2)}%`
  return `${+v.toPrecision(v >= 10 ? 3 : 2)}%`
}

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
