/**
 * Read workspace (spec §18, §21): a sheet that turns signals into concentrations. Type or paste like a spreadsheet;
 * every result carries its range, its CV and a flag against the detection limits. Exports to Excel.
 */
import { useMemo, useRef, useState } from 'react'
import { download, toWire } from '../api'
import { concLabel, fmt, pct2 } from '../format'
import { FLAG_TEXT, readback, type Flag, type ReadRow } from '../math/readback'
import { parseNum } from '../math/tables'
import type { Sample } from '../math/types'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { Page, Scrub, Verdict } from './kit'

const MIN_ROWS = 14
const COLS = ['id', 'signal', 'dilution'] as const
type Col = (typeof COLS)[number]

const TONE: Record<Flag, string | undefined> = {
  ok: undefined,
  invalid: 'var(--faint)',
  below: 'var(--muted)',
  above: 'var(--bad)',
  belowLod: 'var(--muted)',
  belowLoq: 'var(--warm)',
  aboveLoq: 'var(--warm)',
  hook: 'var(--bad)',
}

const blank = (): Sample => ({ id: '', signal: null, dilution: 1 })
const empty = (x: Sample) => x.id === '' && x.signal === null && x.dilution === 1

/** Trailing empty rows are never stored. */
const trim = (rows: Sample[]) => {
  const out = [...rows]
  while (out.length && empty(out[out.length - 1])) out.pop()
  return out
}

function setCell(rows: Sample[], i: number, col: Col, text: string): Sample[] {
  const out = [...rows]
  while (out.length <= i) out.push(blank())
  const cur = { ...out[i] }
  if (col === 'id') cur.id = text.trim()
  else if (col === 'signal') cur.signal = parseNum(text)
  else {
    const v = parseNum(text)
    cur.dilution = v !== null && v > 0 ? v : 1
  }
  out[i] = cur
  return out
}

/** Spreadsheet paste: the block lands at the focused cell and runs right and down. A text header row is skipped. */
export function pasteBlock(rows: Sample[], i0: number, col0: Col, text: string): Sample[] {
  const lines = text.replace(/\r/g, '').split('\n')
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  let grid = lines.map((l) => (l.includes('\t') ? l.split('\t') : l.includes(';') ? l.split(';') : l.split(',')))
  const c0 = COLS.indexOf(col0)
  const sigAt = 1 - c0 // index of the signal within a pasted row
  if (grid.length > 1 && sigAt >= 0 && grid[0][sigAt] !== undefined && parseNum(grid[0][sigAt]) === null && grid[0][sigAt].trim() !== '') grid = grid.slice(1)
  let out = rows
  grid.forEach((cells, r) => cells.slice(0, COLS.length - c0).forEach((t, k) => (out = setCell(out, i0 + r, COLS[c0 + k], t))))
  return trim(out)
}

const rangeText = (r: ReadRow) => (r.resultLo === null || r.resultHi === null ? '' : `${fmt(r.resultLo)} – ${fmt(r.resultHi)}`)

export function ReadWorkspace({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const notify = useStore((s) => s.notify)
  const conf = useStore((s) => s.ui.readConf)
  const setUi = useStore((s) => s.setUi)
  const { series: s, model: m } = d
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const table = useRef<HTMLTableElement>(null)
  const res = useMemo(() => {
    try {
      return readback(m, s.samples, s.limits, conf)
    } catch {
      return null
    }
  }, [m, s.samples, s.limits, conf])
  const rows = [...s.samples, ...Array.from({ length: Math.max(2, MIN_ROWS - s.samples.length) }, blank)]
  const commit = (next: Sample[]) => patch({ samples: trim(next) })
  const filled = res ? res.rows.filter((r) => r.flag !== 'invalid') : []
  const okN = filled.filter((r) => r.flag === 'ok').length
  const u = s.units ? ` (${s.units})` : ''
  const focusCell = (i: number, col: Col) => (table.current?.querySelector(`[data-cell="${i}-${col}"]`) as HTMLInputElement | null)?.focus()

  const tsv = () =>
    res
      ? [['Sample', s.signalLabel || 'Signal', 'Dilution', `Concentration${u}`, `Result${u}`, 'Low', 'High', 'CV %', 'Flag'].join('\t')]
          .concat(res.rows.filter((r) => r.flag !== 'invalid' || r.id).map((r) => [r.id, r.signal ?? '', r.dilution, r.c ?? '', r.result ?? '', r.resultLo ?? '', r.resultHi ?? '', r.cv === null ? '' : +(r.cv * 100).toPrecision(3), FLAG_TEXT[r.flag]].join('\t')))
          .join('\n')
      : ''

  const exportXlsx = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/readback/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: toWire(s), conf }) })
      if (!r.ok) throw new Error(`Export failed (${r.status})`)
      const cd = r.headers.get('content-disposition') ?? ''
      const mm = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)
      download(await r.blob(), mm ? decodeURIComponent(mm[1]) : 'calwizard_results.xlsx')
    } catch (e) {
      // no backend: a CSV carries the same rows
      download(new Blob([tsv().replace(/\t/g, ',')], { type: 'text/csv' }), 'calwizard_results.csv')
      setErr(`${e instanceof Error ? e.message : String(e)}: saved a CSV instead`)
      setTimeout(() => setErr(''), 6000)
    }
    setBusy(false)
  }

  const cell = (i: number, col: Col, value: string, align: 'left' | 'right', placeholder?: string) => (
    <input
      type="text"
      data-cell={`${i}-${col}`}
      className="cell"
      style={{ textAlign: align }}
      defaultValue={value}
      key={`${i}-${col}-${value}`}
      placeholder={placeholder}
      inputMode={col === 'id' ? 'text' : 'decimal'}
      onBlur={(e) => e.target.value !== value && commit(setCell(s.samples, i, col, e.target.value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
          requestAnimationFrame(() => focusCell(i + 1, col))
        } else if (e.key === 'ArrowUp' && i > 0) {
          e.preventDefault()
          focusCell(i - 1, col)
        }
      }}
      onPaste={(e) => {
        const text = e.clipboardData.getData('text/plain')
        if (!/[\t\n]/.test(text.trim())) return
        e.preventDefault()
        e.stopPropagation()
        const next = pasteBlock(s.samples, i, col, text)
        commit(next)
        notify(`Pasted ${next.length - Math.min(i, s.samples.length)} rows`)
      }}
    />
  )

  return (
    <Page width={980}>
      <Verdict sub={`Paste a column of signals into the ${s.signalLabel || 'Signal'} column (or sample names and signals together). Results follow the curve as it is now, including any what-if.`}>
        {filled.length ? `${filled.length} ${filled.length === 1 ? 'reading' : 'readings'} read back, ${okN} inside the quantifiable range.` : 'Read signals back to concentrations.'}
      </Verdict>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Scrub label="range covers" value={+(conf * 100).toPrecision(4)} step={0.05} min={50} max={99.9} width={48} suffix="%" onChange={(v) => setUi({ readConf: Math.min(0.999, Math.max(0.5, v / 100)) })} title="Coverage of the low – high range around each result" />
        {res && (
          <span className="label">
            LoD {fmt(res.lod)} · LoQ {fmt(res.loq)} · upper limit {fmt(res.uloq)}
            {s.units ? ` ${s.units}` : ''}
          </span>
        )}
        <span className="flex-1" />
        {err && <span className="text-[11px] text-bad">{err}</span>}
        <button className="btn" disabled={!filled.length} onClick={() => navigator.clipboard?.writeText(tsv()).then(() => notify('Results copied: paste them into a spreadsheet', false))}>
          Copy
        </button>
        <button className="btn" disabled={!filled.length || busy} onClick={exportXlsx} title="Download the sheet as an Excel workbook">
          Export Excel
        </button>
        <button
          className="btn"
          disabled={!s.samples.length}
          onClick={() => {
            commit([])
            notify('Sheet cleared')
          }}
        >
          Clear
        </button>
      </div>

      <table ref={table} className="sheet w-full text-[12.5px]">
        <thead>
          <tr className="text-muted">
            <th className="w-9 py-1 text-center">#</th>
            <th className="px-2 py-1 text-left">Sample</th>
            <th className="px-2 py-1 text-right">{s.signalLabel || 'Signal'}</th>
            <th className="w-[76px] px-2 py-1 text-right" title="Dilution factor: the result is the concentration times this">
              Dilution
            </th>
            <th className="px-2 py-1 text-right">{concLabel(s)}</th>
            <th className="px-2 py-1 text-right">{fmt(conf * 100, 3)}% range</th>
            <th className="w-[62px] px-2 py-1 text-right">CV</th>
            <th className="py-1 pl-4 pr-2 text-left">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x, i) => {
            const r = res?.rows[i]
            const tone = r ? TONE[r.flag] : undefined
            const out = r && r.flag !== 'invalid'
            return (
              <tr key={i}>
                <td className="text-center text-faint">{i + 1}</td>
                <td>{cell(i, 'id', x.id, 'left', i === 0 && !s.samples.length ? 'sample name' : undefined)}</td>
                <td>{cell(i, 'signal', x.signal === null ? '' : String(x.signal), 'right', i === 0 && !s.samples.length ? 'paste here' : undefined)}</td>
                <td>{cell(i, 'dilution', x.dilution === 1 ? '' : String(x.dilution), 'right', '1')}</td>
                <td className="px-2 text-right font-semibold" style={{ color: tone }}>
                  {out ? (r.flag === 'below' ? `< ${fmt(res?.lod)}` : r.flag === 'above' ? `> ${fmt(m.cMax * r.dilution)}` : fmt(r.result)) : ''}
                </td>
                <td className="px-2 text-right text-muted">{out ? rangeText(r) : ''}</td>
                <td className="px-2 text-right text-muted">{out && r.cv !== null ? pct2(r.cv) : ''}</td>
                <td className="pl-4 pr-2 text-left" style={{ color: tone }}>
                  {out ? FLAG_TEXT[r.flag] : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Page>
  )
}
