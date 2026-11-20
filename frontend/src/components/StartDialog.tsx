/**
 * Start (spec §21): an example gallery and the ways to bring your own data, in one dialog. Also the column chooser
 * shown when a reader export has more than one possible signal column.
 */
import { useMemo, useRef, useState } from 'react'
import { Spark } from '../charts/svg'
import { EXAMPLES } from '../examples'
import { fmt } from '../format'
import { compileModel } from '../math/model'
import { defaultSeries } from '../math/presets'
import { parseReader } from '../math/reader'
import { applyReader, importFile, importText } from '../state/importData'
import { sanitizeSeries, useStore } from '../state/store'
import { Modal } from './kit'

function ExampleCard({ id }: { id: string }) {
  const ex = EXAMPLES.find((e) => e.id === id)!
  const replace = useStore((s) => s.replaceActive)
  const openDialog = useStore((s) => s.openDialog)
  const notify = useStore((s) => s.notify)
  const series = useMemo(() => sanitizeSeries({ ...defaultSeries(), ...ex.series }), [ex])
  const m = useMemo(() => compileModel(series), [series])
  return (
    <button
      className="card-btn flex flex-col gap-1.5 rounded-lg border border-line p-3 text-left"
      onClick={() => {
        replace(series)
        openDialog(null)
        notify(`Started from “${ex.title}”`)
      }}
    >
      <Spark f={m.mean} band={m.sd} x1={m.cMax} w={176} h={52} />
      <span className="text-[13px] font-semibold">{ex.title}</span>
      <span className="text-[11.5px] leading-snug text-muted">{ex.blurb}</span>
    </button>
  )
}

export function StartDialog() {
  const openDialog = useStore((s) => s.openDialog)
  const file = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  return (
    <Modal title="Start" onClose={() => openDialog(null)} width={760}>
      <div className="label mb-2">Start from an example</div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {EXAMPLES.map((e) => (
          <ExampleCard key={e.id} id={e.id} />
        ))}
      </div>
      <div className="label mb-2 mt-5">Or bring your own data</div>
      <div
        className="rounded-lg border border-dashed p-3"
        style={{ borderColor: over ? 'var(--accent)' : 'var(--line)', background: over ? 'var(--accent-soft)' : undefined }}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) void importFile(f)
        }}
      >
        <textarea
          className="mono block h-[92px] w-full resize-none rounded-md border border-line bg-transparent p-2"
          placeholder={'Paste a reader export or a table here, or drop a file.\n\nConc (ng/mL), T, C, T/C\nblank, 48, 900, 0.053\n5, 95, 905, 0.105'}
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setErr('')
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            className="btn primary"
            disabled={!text.trim()}
            onClick={() => {
              if (!importText(text)) setErr('No table found: it needs a header row, a concentration column and a signal column (or concentrations across the top).')
            }}
          >
            Import
          </button>
          <button className="btn" onClick={() => file.current?.click()} title="CSV, TSV or text from a reader; a saved .calwizard.json; or an exported report (.html)">
            Choose a file…
          </button>
          <span className="label">You can also paste (Ctrl+V) or drop a file anywhere in the app.</span>
          <input
            ref={file}
            type="file"
            accept=".csv,.tsv,.txt,.json,.html,text/csv,text/plain,application/json,text/html"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importFile(f)
            }}
          />
        </div>
        {err && <div className="mt-2 text-[12px] text-bad">{err}</div>}
      </div>
    </Modal>
  )
}

/** Column chooser for a reader export: which column is the concentration, which is the signal. */
export function ImportDialog() {
  const text = useStore((s) => s.importText) ?? ''
  const openDialog = useStore((s) => s.openDialog)
  const first = useMemo(() => parseReader(text), [text])
  const [conc, setConc] = useState<number | null>(first?.concCol ?? null)
  const [signal, setSignal] = useState<number | null>(first?.signalCols[0] ?? null)
  const parsed = useMemo(() => (conc === null || signal === null ? null : parseReader(text, conc, signal)), [text, conc, signal])
  if (!first) return null
  const cols = first.columns.map((c, j) => ({ ...c, j })).filter((c) => c.name !== '')
  const stats = parsed?.concs.map((c, j) => {
    const ys = parsed.cells[j]
    const mean = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null
    const sd = ys.length > 1 && mean !== null ? Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / (ys.length - 1)) : null
    return { c, n: ys.length, mean, sd }
  })
  return (
    <Modal title="Import reader data" onClose={() => openDialog(null)} width={560}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="inline-flex items-center gap-2">
          <span className="label">Concentration</span>
          <select value={conc ?? ''} onChange={(e) => setConc(Number(e.target.value))}>
            {cols.map((c) => (
              <option key={c.j} value={c.j}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2">
          <span className="label">Signal</span>
          <select value={signal ?? ''} onChange={(e) => setSignal(Number(e.target.value))}>
            {cols
              .filter((c) => c.j !== conc)
              .map((c) => (
                <option key={c.j} value={c.j}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {stats ? (
        <table className="mt-3 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-right text-muted">
              <th className="pb-1 text-left font-normal">Concentration{parsed?.units ? ` (${parsed.units})` : ''}</th>
              <th className="pb-1 font-normal">Readings</th>
              <th className="pb-1 font-normal">Mean</th>
              <th className="pb-1 font-normal">SD</th>
              <th className="pb-1 font-normal">CV</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((r) => (
              <tr key={r.c} className="border-t border-line text-right">
                <td className="py-1 text-left">{fmt(r.c, 4)}</td>
                <td className="py-1">{r.n}</td>
                <td className="py-1">{fmt(r.mean, 4)}</td>
                <td className="py-1">{fmt(r.sd)}</td>
                <td className="py-1">{r.sd !== null && r.mean ? `${fmt((100 * r.sd) / Math.abs(r.mean), 2)}%` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mt-3 text-[12px] text-bad">These two columns do not hold a concentration and a numeric signal.</div>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button className="btn" onClick={() => openDialog(null)}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!parsed}
          onClick={() => {
            if (parsed) applyReader(parsed)
            openDialog(null)
          }}
        >
          Import
        </button>
      </div>
    </Modal>
  )
}
