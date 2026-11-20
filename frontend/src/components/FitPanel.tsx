import { useState } from 'react'
import { fitData, type Fit, type FitResult } from '../api'
import { fmt } from '../format'
import { replicateStats, summaryPoints, normLevels } from '../math/tables'
import { useStore } from '../state/store'
import type { Derived } from '../state/derived'
import { IconX } from './ui'

function FitList({ title, fits, onPick, onHover }: { title: string; fits: Fit[]; onPick: (f: Fit) => void; onHover: (f: Fit | null) => void }) {
  const good = fits.filter((f) => f.ok && f.expr).slice(0, 3)
  return (
    <div>
      <div className="label mb-0.5">{title}</div>
      {good.length === 0 && <div className="text-[11px] text-muted">no fit</div>}
      {good.map((f) => (
        <button
          key={f.kind}
          className="block w-full cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-left hover:bg-hover"
          onClick={() => {
            onHover(null)
            onPick(f)
          }}
          onMouseEnter={() => onHover(f)}
          onMouseLeave={() => onHover(null)}
          title={`${f.expr}\n(hover shows it dashed on the chart; click to use)`}
        >
          <div className="flex justify-between gap-2 text-[12px]">
            <span>{f.kind}</span>
            <span className="text-muted">AICc {fmt(f.aicc, 4)}</span>
          </div>
          <div className="mono truncate text-[11px] text-muted">{f.expr}</div>
        </button>
      ))}
    </div>
  )
}

/** "Fit equations" button + ranked results; shown in every mode while results exist. */
export function FitPanel({ d, showButton }: { d: Derived; showButton: boolean }) {
  const patch = useStore((s) => s.patch)
  const notify = useStore((s) => s.notify)
  const setGhost = useStore((s) => s.setGhost)
  const [res, setRes] = useState<FitResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const { series, model } = d

  const run = async () => {
    setBusy(true)
    setErr('')
    try {
      const typedCols = series.mode === 'replicates' && summaryPoints(series.summary).some((p) => series.replicates.concs.includes(p.c) && !replicateStats(series.replicates).some((r) => r.c === p.c))
      if (series.mode === 'replicates' && !typedCols) {
        const points = replicateStats(series.replicates).flatMap((s) => s.ys.map((y) => ({ c: s.c, y })))
        setRes(await fitData({ points }))
      } else if (typedCols) {
        // mixed table: fit the per-level mean / sd the charts use
        setRes(await fitData({ summary: model.levels.map((c) => ({ c, mean: model.mean(c), sd: model.sd(c) })) }))
      } else {
        setRes(await fitData({ summary: summaryPoints(series.summary) }))
      }
    } catch {
      setErr('Fit unavailable (backend not reachable)')
    }
    setBusy(false)
  }
  /** Switch to equations, carrying the table's levels / c max over the first time. */
  const toEq = () => (series.mode === 'equations' ? {} : { mode: 'equations' as const, levels: normLevels(model.levels), cMax: model.cMax })
  return (
    <div className="flex flex-col gap-2">
      {showButton && (
        <div className="flex items-center gap-2">
          <button className="btn" onClick={run} disabled={busy}>
            {busy ? 'Fitting…' : 'Table → Equations'}
          </button>
          {err && <span className="text-[11px] text-bad">{err}</span>}
        </div>
      )}
      {res && (
        <div className="flex flex-col gap-2 border-t border-line pt-2">
          <div className="flex items-center justify-between">
            <span className="label">click to use</span>
            <button className="btn ghost text-faint" style={{ height: 18, padding: '0 4px' }} onClick={() => setRes(null)} title="Dismiss">
              <IconX />
            </button>
          </div>
          <FitList title="mean(c)" fits={res.meanFits} onHover={(f) => setGhost(f ? { meanExpr: f.expr } : null)} onPick={(f) => {
              patch({ ...toEq(), meanExpr: f.expr })
              notify(`Using the ${f.label} fit for mean(c)`)
            }} />
          <FitList title="sd(S)" fits={res.sdFits} onHover={(f) => setGhost(f ? { sdExpr: f.expr } : null)} onPick={(f) => {
              patch({ ...toEq(), sdExpr: f.expr })
              notify(`Using the ${f.label} fit for sd(S)`)
            }} />
        </div>
      )}
    </div>
  )
}
