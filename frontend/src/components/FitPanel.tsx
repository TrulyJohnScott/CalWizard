import { useEffect, useRef, useState } from 'react'
import { fitData, type Fit, type FitResult } from '../api'
import { fmt } from '../format'
import type { Model } from '../math/model'
import { replicateStats, summaryPoints } from '../math/tables'
import type { Series } from '../math/types'
import { useStore } from '../state/store'

/** What to fit from a table-mode series: raw replicate points, or the per-level mean / sd. */
export function fitBody(series: Series, model: Model): Parameters<typeof fitData>[0] {
  const typedCols =
    series.mode === 'replicates' &&
    summaryPoints(series.summary).some((p) => series.replicates.concs.includes(p.c) && !replicateStats(series.replicates).some((r) => r.c === p.c))
  if (series.mode === 'replicates' && !typedCols) return { points: replicateStats(series.replicates).flatMap((s) => s.ys.map((y) => ({ c: s.c, y }))) }
  if (typedCols) return { summary: model.levels.map((c) => ({ c, mean: model.mean(c), sd: model.sd(c) })) }
  return { summary: summaryPoints(series.summary) }
}

/**
 * Live fits of μ(c) and σ(S) while the table drives the curve (spec §11 v2.9): refitted 400 ms after the table
 * changes, through the backend fit (the same engine as `calwizard fit`).
 */
export function useAutoFit(series: Series, model: Model, on: boolean) {
  const [res, setRes] = useState<FitResult | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    if (!on) return
    const my = ++seq.current
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const r = await fitData(fitBody(series, model))
        if (my === seq.current) {
          setRes(r)
          setErr('')
        }
      } catch {
        if (my === seq.current) setErr('Fits need the API server (port 8000)')
      }
      if (my === seq.current) setBusy(false)
    }, 400)
    return () => clearTimeout(t)
    // refit only when the table data change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, series.mode, series.replicates, series.summary])
  return { res: on ? res : null, err: on ? err : '', busy: on && busy }
}

/** Ranked fits (top 3); hover previews dashed on the chart, click uses it. */
export function FitList({ title, fits, chosen, onPick }: { title: string; fits: Fit[]; chosen?: string; onPick: (f: Fit) => void }) {
  const setGhost = useStore((s) => s.setGhost)
  const good = fits.filter((f) => f.ok && f.expr).slice(0, 3)
  const isMean = title.startsWith('μ')
  return (
    <div>
      <div className="label mb-0.5">{title}</div>
      {good.length === 0 && <div className="text-[11px] text-muted">no fit</div>}
      {good.map((f) => (
        <button
          key={f.kind}
          className="block w-full cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-left hover:bg-hover"
          style={chosen === f.expr ? { boxShadow: 'inset 2px 0 0 var(--accent)' } : undefined}
          onClick={() => {
            setGhost(null)
            onPick(f)
          }}
          onMouseEnter={() => setGhost(isMean ? { meanExpr: f.expr } : { sdExpr: f.expr })}
          onMouseLeave={() => setGhost(null)}
          title={`${f.expr}\n(hover shows it dashed on the chart; click to drive from it)`}
        >
          <div className="flex justify-between gap-2 text-[12px]">
            <span>{f.label}</span>
            <span className="text-muted">
              {f.r2 !== null ? `R² ${fmt(f.r2, 3)} · ` : ''}AICc {fmt(f.aicc, 4)}
            </span>
          </div>
          <div className="mono truncate text-[11px] text-muted">{f.expr}</div>
        </button>
      ))}
    </div>
  )
}
