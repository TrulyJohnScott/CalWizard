/**
 * Spec §19: reader import. A delimited text export from a strip reader (a header row, then one row per strip or
 * sample) becomes a replicate table. Port of backend/app/importer.py (parity via the fixtures `importCases`).
 */
const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/
const NUM_PREFIX = /^([-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)\s*[A-Za-z%/ ]*$/
const BLANK = /^(blank|neg|negative|zero|nc|buffer|bkg|background)$/i
const CONC = /conc|dose|standard|^std$|level|calibrator|ng\/|pg\/|ug\/|mg\/|iu\/|mol/i
const SKIP = /^(rep|replicate|well|strip|id|sample|no|n|index|time|date|lot|operator|run|day|position|pos|cassette|reader|name|#)$/i
const PREF = [/t\s*\/\s*c|ratio/i, /test|^t$|t.?line|signal|intensity|peak|area|response|^od|rlu|^au$/i]
const REPCOL = /^(rep|replicate|r|read|reading|strip|run|meas|measurement)?\s*#?\s*\d+$/i
const UNITS = /[([]\s*([^)\]]+?)\s*[)\]]/

export interface ReaderColumn {
  name: string
  role: 'conc' | 'signal' | 'candidate' | 'other'
}

export interface ReaderImport {
  concs: number[]
  cells: number[][]
  units: string | null
  signalLabel: string | null
  columns: ReaderColumn[]
  concCol: number
  signalCols: number[]
  rows: number
  header: number
}

const clean = (cell: string) => {
  let t = cell.trim()
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') t = t.slice(1, -1).trim()
  return t
}

/** A plain number (comma decimals tolerated), else null. */
export function readerNumber(cell: string): number | null {
  let t = cell.split(' ').join('')
  if (t.includes(',') && !t.includes('.')) t = t.split(',').join('.')
  return NUM.test(t) ? Number(t) : null
}

/** A concentration cell: a number, a number with a unit suffix (`5 ng/mL`), or a blank word (0). */
export function concNumber(cell: string): number | null {
  const t = cell.trim()
  if (BLANK.test(t)) return 0
  const v = readerNumber(t)
  if (v !== null) return v
  const m = NUM_PREFIX.exec(t)
  return m ? Number(m[1]) : null
}

/** The delimiter that splits the most lines into the same number (≥ 2) of fields (ties: tab, `;`, `,`). */
function delimiter(lines: string[]): string {
  let best = ','
  let score = -1
  for (const d of ['\t', ';', ',']) {
    const counts = new Map<number, number>()
    for (const ln of lines) {
      const k = ln.split(d).length
      if (k >= 2) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const s = Math.max(0, ...counts.values())
    if (s > score) {
      best = d
      score = s
    }
  }
  return best
}

function split(text: string): string[][] {
  const lines = text.split('\r').join('').split('\n').filter((ln) => ln.trim() !== '')
  const delim = delimiter(lines)
  return lines.map((ln) => ln.split(delim).map(clean))
}

function headerRow(rows: string[][]): number | null {
  for (let i = 0; i + 1 < rows.length; i++) {
    const cells = rows[i].filter((c) => c !== '')
    if (cells.length < 2 || cells.every((c) => readerNumber(c) !== null)) continue
    if (rows[i + 1].filter((c) => concNumber(c) !== null).length >= 2) return i
  }
  return null
}

function pick(names: string[], want: string | number | null | undefined): number | null {
  if (want === null || want === undefined) return null
  if (typeof want === 'number') return Number.isInteger(want) && want >= 0 && want < names.length ? want : null
  const j = names.map((n) => n.toLowerCase()).indexOf(want.trim().toLowerCase())
  return j >= 0 ? j : null
}

/** Parse a reader export; `conc` / `signal` choose columns by header name or 0-based index. Null if not a reader table. */
export function parseReader(text: string, conc?: string | number | null, signal?: string | number | null): ReaderImport | null {
  const rows = split(text)
  const h = headerRow(rows)
  if (h === null) return null
  const names = rows[h]
  const width = names.length
  const data = rows.slice(h + 1).map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')] as string[])
  const frac = (j: number, fn: (c: string) => number | null) => {
    const cells = data.map((r) => r[j]).filter((c) => c !== '')
    return cells.length ? cells.filter((c) => fn(c) !== null).length / cells.length : 0
  }
  const idx = [...Array(width).keys()]
  let cj = pick(names, conc)
  if (cj === null && (conc === null || conc === undefined)) {
    cj = idx.find((j) => CONC.test(names[j]) && frac(j, concNumber) >= 0.6) ?? null
    if (cj === null) cj = idx.find((j) => !SKIP.test(names[j]) && frac(j, concNumber) === 1) ?? null
  }
  if (cj === null) return null
  const cc = cj
  const used = data.filter((r) => concNumber(r[cc]) !== null)
  if (!used.length) return null
  const share = (j: number) => {
    const cells = used.map((r) => r[j]).filter((c) => c !== '')
    return cells.length ? cells.filter((c) => readerNumber(c) !== null).length / cells.length : 0
  }
  const cands = idx.filter((j) => j !== cc && names[j] !== '' && !SKIP.test(names[j]) && share(j) >= 0.8)
  let sig: number[]
  if (signal !== null && signal !== undefined) {
    // one column, or several separated by commas ("Rep 1,Rep 2")
    const wants = typeof signal === 'string' && signal.includes(',') ? signal.split(',').map((w) => w.trim()) : [signal]
    const picked = wants.map((w) => pick(names, w))
    if (picked.some((j) => j === null || j === cc)) return null
    sig = picked as number[]
  } else {
    if (!cands.length) return null
    const reps = cands.filter((j) => REPCOL.test(names[j]))
    if (reps.length >= 2) sig = reps // replicate columns win even beside other numeric columns (C line, T line)
    else sig = [cands.find((j) => PREF[0].test(names[j])) ?? cands.find((j) => PREF[1].test(names[j])) ?? cands[0]]
  }
  const groups = new Map<number, number[]>()
  for (const r of used) {
    const c = concNumber(r[cc]) as number
    if (c < 0) continue
    const vals = sig.map((j) => readerNumber(r[j])).filter((v): v is number => v !== null)
    groups.set(c, [...(groups.get(c) ?? []), ...vals])
  }
  let concs = [...groups.keys()].sort((a, b) => a - b)
  if (!groups.has(0)) concs = [0, ...concs]
  const um = UNITS.exec(names[cc])
  return {
    concs,
    cells: concs.map((c) => groups.get(c) ?? []),
    units: um ? um[1] : null,
    signalLabel: sig.length === 1 ? names[sig[0]] : null,
    columns: idx.map((j) => ({ name: names[j], role: j === cc ? 'conc' : sig.includes(j) ? 'signal' : cands.includes(j) ? 'candidate' : 'other' })),
    concCol: cc,
    signalCols: sig,
    rows: used.length,
    header: h,
  }
}
