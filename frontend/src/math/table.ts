import type { Model } from './model'
import { levelDots } from './sim'
import { parseReplicatesBlock, parseSummaryBlock } from './tables'
import type { Series, SummaryRow } from './types'

/**
 * The unified Table view (spec v2.2): concentrations across the top (column 0 fixed at 0), replicate
 * signals underneath; a column without replicates can carry a typed mean / sd instead.
 */
export interface TableData {
  concs: (number | null)[]
  cells: (number | null)[][]
  typed: { mean: number | null; sd: number | null }[]
}

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const hasValues = (col: (number | null)[] | undefined) => !!col && col.some(num)

/** Does the replicates payload carry any signal? Decides which table mode is entered from Equations. */
export const hasReplicateData = (s: Pick<Series, 'replicates'>) => s.replicates.cells.some(hasValues)

/** Table view of a series in a table mode (mode 'replicates' or 'summary'). */
export function toTable(s: Series): TableData {
  if (s.mode === 'summary') {
    const rows = s.summary.length && s.summary[0].c === 0 ? s.summary : [{ c: 0, mean: null, sd: null }, ...s.summary]
    return { concs: rows.map((r) => r.c), cells: rows.map(() => []), typed: rows.map((r) => ({ mean: r.mean, sd: r.sd })) }
  }
  const concs = s.replicates.concs.slice()
  if (!concs.length) concs.push(0)
  concs[0] = 0
  const cells = concs.map((_, j) => (s.replicates.cells[j] ?? []).slice())
  const typed = concs.map((c, j) => {
    if (hasValues(cells[j]) || !num(c)) return { mean: null, sd: null }
    const r = s.summary.find((x) => x.c === c)
    return { mean: r?.mean ?? null, sd: r?.sd ?? null }
  })
  return { concs, cells, typed }
}

/** Trim trailing empty columns (never column 0) and trailing empty replicate rows. */
export function normTable(t: TableData): TableData {
  const concs = t.concs.slice()
  const cells = concs.map((_, j) => (t.cells[j] ?? []).slice())
  const typed = concs.map((_, j) => t.typed[j] ?? { mean: null, sd: null })
  concs[0] = 0
  const empty = (j: number) => !num(concs[j]) && !hasValues(cells[j]) && typed[j].mean === null && typed[j].sd === null
  while (concs.length > 1 && empty(concs.length - 1)) {
    concs.pop()
    cells.pop()
    typed.pop()
  }
  for (const col of cells) while (col.length && !num(col[col.length - 1])) col.pop()
  return { concs, cells, typed }
}

/** Series fields (mode + payloads) that express this table. */
export function fromTable(t: TableData): Pick<Series, 'mode' | 'replicates' | 'summary'> {
  const n = normTable(t)
  const withData = n.cells.some(hasValues)
  const summary: SummaryRow[] = []
  n.concs.forEach((c, j) => {
    if (!num(c) || hasValues(n.cells[j])) return
    summary.push({ c, mean: n.typed[j].mean, sd: n.typed[j].sd })
  })
  if (!summary.length || summary[0].c !== 0) summary.unshift({ c: 0, mean: null, sd: null })
  return { mode: withData ? 'replicates' : 'summary', replicates: { concs: n.concs, cells: n.cells }, summary }
}

export type CellRef = { kind: 'conc'; j: number } | { kind: 'rep'; j: number; i: number } | { kind: 'mean' | 'sd'; j: number }

/** Set one cell; typing past the edge grows the table. Column 0 conc is fixed; mean/sd are only editable without replicates. */
export function setTableCell(t: TableData, ref: CellRef, v: number | null): TableData {
  const concs = t.concs.slice()
  const cells = t.cells.map((c) => c.slice())
  const typed = t.typed.map((x) => ({ ...x }))
  while (concs.length <= ref.j) {
    concs.push(null)
    cells.push([])
    typed.push({ mean: null, sd: null })
  }
  if (ref.kind === 'conc') {
    if (ref.j === 0) return t
    concs[ref.j] = v !== null && v < 0 ? null : v
  } else if (ref.kind === 'rep') {
    while (cells[ref.j].length <= ref.i) cells[ref.j].push(null)
    cells[ref.j][ref.i] = v
  } else {
    if (hasValues(cells[ref.j])) return t
    typed[ref.j][ref.kind] = v
  }
  return { concs, cells, typed }
}

/** Equations -> Table: header = current levels; n > 0 simulated replicates, else typed mean / sd. */
export function tableFromEquations(s: Series, m: Model, n: number): TableData {
  const r = (v: number) => (Number.isFinite(v) ? +v.toPrecision(5) : null)
  const concs = m.levels.slice()
  if (n > 0) {
    const dots = levelDots({ ...s, mode: 'equations', sim: { ...s.sim, n } }, m)
    return { concs, cells: dots.map((d) => d.ys.map(r)), typed: concs.map(() => ({ mean: null, sd: null })) }
  }
  return { concs, cells: concs.map(() => []), typed: concs.map((c) => ({ mean: r(m.mean(c)), sd: r(m.sd(c)) })) }
}

/** Whole-table paste from a block with row / column labels (c, mean, sd or a labelled first cell). */
export function pasteWhole(text: string): TableData | null {
  const first = text.replace(/\r/g, '').split('\n')[0] ?? ''
  const firstCell = first.split('\t')[0]?.trim() ?? ''
  if (firstCell === '' || !Number.isNaN(Number(firstCell))) return null
  if (/^\s*(mean|avg|average|sd|std)/im.test(text.split('\n').slice(1).join('\n'))) {
    const rows = parseSummaryBlock(text)
    if (!rows) return null
    const body = rows[0]?.c === 0 ? rows : [{ c: 0, mean: null, sd: null }, ...rows]
    return { concs: body.map((r) => r.c), cells: body.map(() => []), typed: body.map((r) => ({ mean: r.mean, sd: r.sd })) }
  }
  const rep = parseReplicatesBlock(text)
  if (!rep) return null
  const concs = rep.concs[0] === 0 ? rep.concs : [0, ...rep.concs]
  const cells = rep.concs[0] === 0 ? rep.cells : [[], ...rep.cells]
  return { concs, cells, typed: concs.map(() => ({ mean: null, sd: null })) }
}

/** Per-column computed stats shown in the mean / sd rows (null when the column has no replicates). */
export function columnStats(t: TableData): ({ n: number; mean: number; sd: number | null } | null)[] {
  return t.concs.map((_, j) => {
    const ys = (t.cells[j] ?? []).filter(num)
    if (!ys.length) return null
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length
    const sd = ys.length > 1 ? Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / (ys.length - 1)) : null
    return { n: ys.length, mean, sd }
  })
}

/** One quick-entry item: `c:v1,v2,v3` (replicates), `c:mean±sd` / `c:mean+-sd` (typed), `c:mean` (typed mean). */
export interface QuickItem {
  c: number
  ys?: number[]
  mean?: number
  sd?: number
}

/** Parse quick entry text like `0:48,52,47 1:55±2.5 5:96`; null if any token is not understood. */
export function parseQuick(text: string): QuickItem[] | null {
  const toks = text.split(/[\s;]+/).filter(Boolean)
  if (!toks.length) return null
  const out: QuickItem[] = []
  for (const t of toks) {
    const m = /^([^:=]+)[:=](.+)$/.exec(t)
    if (!m) return null
    const c = Number(m[1])
    if (!(Number.isFinite(c) && c >= 0)) return null
    const rhs = m[2]
    const pm = /^([^±]+?)(?:±|\+-|\+\/-)(.+)$/.exec(rhs)
    if (pm) {
      const mean = Number(pm[1])
      const sd = Number(pm[2])
      if (!Number.isFinite(mean) || !(Number.isFinite(sd) && sd >= 0)) return null
      out.push({ c, mean, sd })
      continue
    }
    const vals = rhs.split(',').filter((x) => x !== '').map(Number)
    if (!vals.length || vals.some((v) => !Number.isFinite(v))) return null
    out.push(vals.length === 1 ? { c, mean: vals[0] } : { c, ys: vals })
  }
  return out
}

/** Merge quick items into a table: an existing concentration's column is replaced, new ones are appended. */
export function mergeQuick(t: TableData, items: QuickItem[]): TableData {
  const concs = [...t.concs]
  const cells = t.cells.map((c) => [...c])
  const typed = t.typed.map((x) => ({ ...x }))
  for (const it of items) {
    let j = concs.indexOf(it.c)
    if (j < 0) {
      concs.push(it.c)
      cells.push([])
      typed.push({ mean: null, sd: null })
      j = concs.length - 1
    }
    if (it.ys) {
      cells[j] = [...it.ys]
      typed[j] = { mean: null, sd: null }
    } else {
      cells[j] = []
      typed[j] = { mean: it.mean ?? null, sd: it.sd ?? null }
    }
  }
  return normTable({ concs, cells, typed })
}

/**
 * Anything tabular pasted anywhere: a labelled block (pasteWhole), long `c<TAB>signal` rows (replicates),
 * unlabelled `c<TAB>mean<TAB>sd` rows, or quick entry text. Null when it is not a table.
 */
export function parseAnyBlock(text: string): TableData | null {
  const whole = text.includes('	') ? pasteWhole(text) : null
  if (whole) return whole
  const rows = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.split(/[\t,;]/).map((x) => x.trim()).filter((x) => x !== ''))
    .filter((r) => r.length)
  const numeric = rows.length >= 2 && rows.every((r) => r.every((x) => Number.isFinite(Number(x))))
  if (numeric && rows.every((r) => r.length === 2)) {
    const by = new Map<number, number[]>()
    for (const [c, y] of rows.map((r) => r.map(Number))) if (c >= 0) by.set(c, [...(by.get(c) ?? []), y])
    if (by.size < 2) return null
    const items = [...by.entries()].map(([c, ys]) => (ys.length > 1 ? { c, ys } : { c, mean: ys[0] }))
    return mergeQuick({ concs: [0], cells: [[]], typed: [{ mean: null, sd: null }] }, items)
  }
  if (numeric && rows.every((r) => r.length === 3)) {
    const items = rows.map((r) => r.map(Number)).filter(([c]) => c >= 0).map(([c, mean, sd]) => ({ c, mean, sd }))
    return items.length >= 2 ? mergeQuick({ concs: [0], cells: [[]], typed: [{ mean: null, sd: null }] }, items) : null
  }
  const q = parseQuick(text.replace(/\n/g, ' '))
  return q && q.length >= 2 ? mergeQuick({ concs: [0], cells: [[]], typed: [{ mean: null, sd: null }] }, q) : null
}
