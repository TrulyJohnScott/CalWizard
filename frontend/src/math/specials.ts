const SQRT_PI = Math.sqrt(Math.PI)

/** erf via the positive-term series (|x| < 2.5), accurate to ~1e-15. */
function erfSeries(x: number): number {
  const x2 = x * x
  let term = x
  let sum = x
  for (let n = 1; n < 200; n++) {
    term *= (2 * x2) / (2 * n + 1)
    sum += term
    if (term < 1e-17 * sum) break
  }
  return (2 / SQRT_PI) * Math.exp(-x2) * sum
}

/** erfc for x >= 2.5 via continued fraction. */
function erfcCF(x: number): number {
  let f = x
  for (let k = 60; k >= 1; k--) f = x + k / 2 / f
  return Math.exp(-x * x) / (SQRT_PI * f)
}

export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN
  if (x < 0) return 2 - erfc(-x)
  if (x < 2.5) return 1 - erfSeries(x)
  return erfcCF(x)
}

/** Standard normal CDF. */
export function normCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2)
}
/** Standard normal survival 1 - Phi(z), accurate in the tail. */
export function normSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2)
}
export function normPdf(x: number, mu: number, sd: number): number {
  if (sd <= 0) return x === mu ? Infinity : 0
  const z = (x - mu) / sd
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI))
}

/** Inverse of normCdf (Acklam's rational approximation + two Halley steps; ~1e-15 relative). p in (0, 1). */
export function normQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const tail = (q: number) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  let x: number
  if (p < 0.02425) x = tail(Math.sqrt(-2 * Math.log(p)))
  else if (p > 1 - 0.02425) x = -tail(Math.sqrt(-2 * Math.log(1 - p)))
  else {
    const q = p - 0.5
    const r = q * q
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  }
  for (let i = 0; i < 2; i++) {
    // Halley on f(x) = Phi(x) - p, using the tail-accurate side
    const e = x < 0 ? normCdf(x) - p : 1 - p - normSf(x)
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp(0.5 * x * x)
    x = x - u / (1 + 0.5 * x * u)
  }
  return x
}
