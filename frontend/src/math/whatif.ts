/**
 * Spec §14: folding the what-if layer into the source ("Keep as the new curve"). Port of backend series.bake:
 * equations get new expressions, tables get transformed concentrations / readings. bake(s) evaluates like s.
 */
import { parseExpr, type Ast } from './expr'
import { compileModel } from './model'
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
  if (s.mode === 'equations') {
    const inner = astToText(parseExpr(s.meanExpr, 'c'), `(c/${lit(xs)})`)
    return {
      ...s,
      adjust: null,
      meanExpr: `${lit(b1)} + (${inner} - ${lit(b0)})*${lit(gain)}`,
      sdExpr: `${lit(ss)}*(${astToText(parseExpr(s.sdExpr, 'S'), 'S')})`,
    }
  }
  const y = (v: number) => b1 + (v - b0) * gain
  const concs = s.replicates.concs.map((c) => (num(c) ? c * xs : c))
  const cells = s.replicates.concs.map((_, j) => {
    const col = s.replicates.cells[j] ?? []
    const vals = col.filter(num)
    const mu = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    return col.map((x) => (num(x) ? y(mu) + (x - mu) * ss : null))
  })
  const summary = s.summary.map((r) => ({ c: num(r.c) ? r.c * xs : r.c, mean: num(r.mean) ? y(r.mean) : r.mean, sd: num(r.sd) ? r.sd * ss : r.sd }))
  return { ...s, adjust: null, replicates: { concs, cells }, summary, extraLevels: (s.extraLevels ?? []).map((c) => c * xs) }
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
