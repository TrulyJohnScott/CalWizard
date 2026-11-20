import type { Replicates, SummaryRow } from './types'

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export interface ColStat {
  /** column index in the grid */
  j: number
  c: number
  n: number
  mean: number
  /** sample SD (n-1); null with fewer than 2 values */
  sd: number | null
  ys: number[]
}

/** Per-column stats for columns with a numeric header and at least one value. */
export function replicateStats(rep: Replicates): ColStat[] {
  const out: ColStat[] = []
  rep.concs.forEach((c, j) => {
    if (!num(c) || c < 0) return
    const ys = (rep.cells[j] ?? []).filter(num)
    if (!ys.length) return
    const n = ys.length
    const mean = ys.reduce((a, b) => a + b, 0) / n
    const sd = n > 1 ? Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null
    out.push({ j, c, n, mean, sd, ys })
  })
  return out
}

export function summaryPoints(rows: SummaryRow[]): { c: number; mean: number; sd: number | null }[] {
  return rows
    .filter((r) => num(r.c) && r.c >= 0 && num(r.mean))
    .map((r) => ({ c: r.c as number, mean: r.mean as number, sd: num(r.sd) ? r.sd : null }))
}

/** Parse a number the way spreadsheets paste it (comma decimals tolerated). */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/\s/g, '')
  if (t === '') return null
  const v = Number(t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t)
  return Number.isFinite(v) ? v : null
}

/** Split clipboard text (Excel TSV, or comma/semicolon separated) into a cell matrix. */
export function splitBlock(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n')
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.map((l) => (l.includes('\t') ? l.split('\t') : l.includes(';') ? l.split(';') : l.includes(',') && !/^[\d.\s,-]+$/.test(l.replace(/\d,\d/g, '')) ? l.split(',') : l.split(/,/)))
}

/**
 * Replicates paste: first row = concentrations, rows below = replicate signals.
 * A leading non-numeric label cell on the first row (e.g. "c") is dropped.
 */
export function parseReplicatesBlock(text: string): Replicates | null {
  const rows = splitBlock(text)
  if (rows.length < 1) return null
  let head = rows[0]
  if (head.length > 1 && parseNum(head[0]) === null && head.slice(1).some((x) => parseNum(x) !== null)) head = head.slice(1)
  const concs = head.map(parseNum)
  if (concs.every((c) => c === null)) return null
  const shift = rows[0].length - head.length
  const cells: (number | null)[][] = concs.map(() => [])
  for (const r of rows.slice(1)) {
    const body = r.slice(shift)
    concs.forEach((_, j) => cells[j].push(parseNum(body[j] ?? '')))
  }
  for (const col of cells) while (col.length && col[col.length - 1] === null) col.pop()
  return { concs, cells }
}

/**
 * Summary paste: rows of `c, mean, sd` (an optional text header row is skipped), or the transposed
 * layout with rows labelled c / mean / sd.
 */
export function parseSummaryBlock(text: string): SummaryRow[] | null {
  let rows = splitBlock(text)
  if (!rows.length) return null
  const label = (s: string | undefined) => (s ?? '').trim().toLowerCase()
  const isLabel = (s: string | undefined) => /^(c|conc\w*|mean|avg|average|sd|std\w*)$/.test(label(s))
  if (rows.length >= 2 && rows.slice(0, 3).every((r) => isLabel(r[0]) || r.length === 0) && parseNum(rows[0][0]) === null) {
    const get = (re: RegExp) => rows.find((r) => re.test(label(r[0])))
    const cr = get(/^(c|conc\w*)$/)
    const mr = get(/^(mean|avg|average)$/)
    const sr = get(/^(sd|std\w*)$/)
    if (cr && mr) {
      const n = Math.max(cr.length, mr.length) - 1
      const out: SummaryRow[] = []
      for (let j = 1; j <= n; j++) out.push({ c: parseNum(cr[j] ?? ''), mean: parseNum(mr[j] ?? ''), sd: sr ? parseNum(sr[j] ?? '') : null })
      return out
    }
  }
  if (rows.length && parseNum(rows[0][0]) === null) rows = rows.slice(1) // header row
  const out = rows.map((r): SummaryRow => ({ c: parseNum(r[0] ?? ''), mean: parseNum(r[1] ?? ''), sd: parseNum(r[2] ?? '') }))
  return out.length ? out : null
}

/** Levels field: "0, 1, 5, 25" -> sorted unique >= 0 with 0 forced in. Null on a bad token. */
export function parseLevels(text: string): number[] | null {
  const toks = text.split(/[\s,;]+/).filter(Boolean)
  const vals: number[] = []
  for (const t of toks) {
    const v = parseNum(t)
    if (v === null || v < 0) return null
    vals.push(v)
  }
  return normLevels(vals)
}

export function normLevels(vals: number[]): number[] {
  return [...new Set([0, ...vals.filter((v) => Number.isFinite(v) && v >= 0)])].sort((a, b) => a - b)
}
