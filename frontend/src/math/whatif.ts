/**
 * Spec §14: folding the what-if layer into the source ("Keep as the new curve"). Port of backend series.bake:
 * equations get new expressions, tables get transformed concentrations / readings. bake(s) evaluates like s.
 */
import { parseExpr, type Ast } from './expr'
import { inverse } from './analysis'
import { compileModel, type Model } from './model'
import { adjustActive, NO_ADJUST, type Adjust, type Series } from './types'

/** Fully parenthesised expression text with the variable replaced by `v`. */
export function astToText(a: Ast, v: string): string {
  switch (a.t) {
    case 'num':
      return String(a.v)
    case 'var':
      return v
    case 'neg':
      return `(-${astToText(a.a, v)})`
    case 'bin':
      return `(${astToText(a.a, v)}${a.op}${astToText(a.b, v)})`
    case 'call':
      return `${a.fn}(${a.args.map((x) => astToText(x, v)).join(',')})`
  }
}

const lit = (x: number) => (x >= 0 ? `(${x})` : `(0 - ${-x})`)
const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export function bake(s: Series): Series {
  if (!adjustActive(s.adjust)) return { ...s, adjust: null }
  const p = compileModel(s).adjust
  if (!p) return { ...s, adjust: null }
  const { b0, b1, gain, cScale: xs, sdScale: ss } = p
  const split = p.floorScale !== 1 || p.cvScale !== 1
  if (s.mode === 'equations') {
    const inner = astToText(parseExpr(s.meanExpr, 'c'), `(c/${lit(xs)})`)
    return {
      ...s,
      adjust: null,
      meanExpr: `${lit(b1)} + (${inner} - ${lit(b0)})*${lit(gain)}`,
      sdExpr: split
        ? `sqrt((${lit(p.floorScale)}*${lit(p.s0 as number)})^2 + ${lit(p.cvScale)}^2*((${lit(ss)}*(${astToText(parseExpr(s.sdExpr, 'S'), 'S')}))^2 - ${lit(p.s0 as number)}^2))`
        : `${lit(ss)}*(${astToText(parseExpr(s.sdExpr, 'S'), 'S')})`,
    }
  }
  const y = (v: number) => b1 + (v - b0) * gain
  const concs = s.replicates.concs.map((c) => (num(c) ? c * xs : c))
  // with the SD interpolated in CV the noise follows the new signal: a deviation scales by ss·|y(μ)|/|μ| (port of bake)
  const byCv = compileModel({ ...s, adjust: null }).cv !== undefined
  // split noise: also scale by the split ratio at each new concentration (port of bake)
  const mSplit = split ? compileModel(s) : null
  const mPlain = split ? compileModel({ ...s, adjust: { ...(s.adjust as Adjust), floorScale: 1, cvScale: 1 } }) : null
  const spread = (mu: number, c?: number) => {
    const base = ss * (byCv && mu !== 0 ? Math.abs(y(mu)) / Math.abs(mu) : 1)
    if (!mSplit || !mPlain || c === undefined) return base
    const den = mPlain.sd(c * xs)
    return base * (den > 0 ? mSplit.sd(c * xs) / den : 1)
  }
  const cells = s.replicates.concs.map((cj, j) => {
    const col = s.replicates.cells[j] ?? []
    const vals = col.filter(num)
    const mu = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    return col.map((x) => (num(x) ? y(mu) + (x - mu) * spread(mu, num(cj) ? cj : undefined) : null))
  })
  const summary = s.summary.map((r) => ({ c: num(r.c) ? r.c * xs : r.c, mean: num(r.mean) ? y(r.mean) : r.mean, sd: num(r.sd) ? r.sd * (num(r.mean) ? spread(r.mean, num(r.c) ? r.c : undefined) : ss) : r.sd }))
  // the chosen data curve follows the what-if like an equation (port of bake)
  const dataFit = s.dataFit?.meanExpr ? { ...s.dataFit, meanExpr: `${lit(b1)} + (${astToText(parseExpr(s.dataFit.meanExpr, 'c'), `(c/${lit(xs)})`)} - ${lit(b0)})*${lit(gain)}` } : (s.dataFit ?? null)
  return { ...s, adjust: null, dataFit, replicates: { concs, cells }, summary, extraLevels: (s.extraLevels ?? []).map((c) => c * xs) }
}

/** The adjust with one field changed, or null when that leaves nothing adjusted. */
export function withAdjust(cur: Adjust | null, p: Partial<Adjust>): Adjust | null {
  const next = { ...NO_ADJUST, ...(cur ?? {}), ...p }
  return adjustActive(next) ? next : null
}

/** Plain-words summary of an active layer, e.g. "background 50 → 30 · top +15% · noise ×0.7". */
export function adjustText(p: { b0: number; t0: number; b1: number; t1: number; cScale: number; sdScale: number }, f: (x: number) => string): string {
  const parts: string[] = []
  if (p.b1 !== p.b0) parts.push(`background ${f(p.b0)} → ${f(p.b1)}`)
  if (p.t1 !== p.t0) parts.push(`top ${f(p.t0)} → ${f(p.t1)}`)
  if (p.cScale !== 1) parts.push(`midpoint ×${f(p.cScale)}`)
  if (p.sdScale !== 1) parts.push(`noise ×${f(p.sdScale)}`)
  return parts.join(' · ')
}

export type HandleKey = 'bottom' | 'top' | 'mid' | 'noise'

/** A drag handle on the curve: where it sits and along which axis it moves. */
export interface Handle {
  key: HandleKey
  c: number
  s: number
  axis: 'signal' | 'conc'
  label: string
}

const NOISE_AT = 0.72

/** The four what-if handles for the curve as it is now (spec §14). */
export function handles(m: Model): Handle[] {
  const b = m.mean(0)
  const t = m.mean(m.cMax)
  const half = inverse(m, 0.5 * (b + t)) ?? m.cMax / 2
  const cn = NOISE_AT * m.cMax
  return [
    { key: 'bottom', c: 0, s: b, axis: 'signal', label: 'background' },
    { key: 'top', c: m.cMax, s: t, axis: 'signal', label: 'top' },
    { key: 'mid', c: half, s: m.mean(half), axis: 'conc', label: 'midpoint' },
    { key: 'noise', c: cn, s: m.mean(cn) + 2 * m.sd(cn), axis: 'signal', label: 'noise' },
  ]
}

const r4 = (x: number) => +x.toPrecision(4)

/** The adjust after dragging handle `key` to concentration c / signal S. Null when the drag makes no sense there. */
export function dragHandle(cur: Adjust | null, m: Model, key: HandleKey, c: number, S: number): Adjust | null | undefined {
  const a = { ...NO_ADJUST, ...(cur ?? {}) }
  const f = m.base?.mean ?? m.mean
  const b0 = m.adjust?.b0 ?? m.mean(0)
  const t0 = m.adjust?.t0 ?? m.mean(m.cMax)
  if (!Number.isFinite(c) || !Number.isFinite(S)) return undefined
  if (key === 'bottom') return withAdjust(cur, { bottom: r4(S) })
  if (key === 'top') {
    const b1 = a.bottom ?? b0
    const denom = f(m.cMax / a.cScale) - b0
    if (!(Math.abs(denom) > 0)) return undefined
    return withAdjust(cur, { top: r4(b1 + ((S - b1) * (t0 - b0)) / denom) })
  }
  if (key === 'mid') {
    const at = handles(m)[2].c
    if (!(at > 0 && c > 0)) return undefined
    return withAdjust(cur, { cScale: r4(Math.min(20, Math.max(0.05, (a.cScale * c) / at))) })
  }
  const cn = NOISE_AT * m.cMax
  const sd = m.sd(cn)
  if (!(sd > 0)) return undefined
  const ratio = (S - m.mean(cn)) / (2 * sd)
  return withAdjust(cur, { sdScale: r4(Math.min(10, Math.max(0.02, a.sdScale * ratio))) })
}
