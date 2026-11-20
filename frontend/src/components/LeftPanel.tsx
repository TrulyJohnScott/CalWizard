import { useMemo, useState } from 'react'
import type { Fit } from '../api'
import { MEAN_PRESETS, SD_PRESETS } from '../math/presets'
import { fromTable, tableFromEquations, toTable as tableOf } from '../math/table'
import { normLevels } from '../math/tables'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { EquationsEditor, ExprField } from './EquationsEditor'
import { FitList, useAutoFit } from './FitPanel'
import { QuickEntry, TableEditor } from './TableEditor'
import { IconChevron, Seg } from './ui'

type View = 'equations' | 'table'

/**
 * Left panel: one truth, two views (spec §11 v2.9). The Equations | Table switch only changes the view. Whichever
 * side drives the curve is edited as before; the other is shown live (fits of μ(c) and σ(S) from the table, or the
 * equations' values in the table), and editing it makes it the driver (one undo step).
 */
export function LeftPanel({ d }: { d: Derived }) {
  const open = useStore((s) => s.ui.left)
  const view = useStore((s) => s.ui.inputView)
  const setUi = useStore((s) => s.setUi)
  const patch = useStore((s) => s.patch)
  const setLadder = useStore((s) => s.setLadder)
  const clearMeasure = useStore((s) => s.clearMeasure)
  const notify = useStore((s) => s.notify)
  const [wide, setWide] = useState(false)
  const { series, model } = d
  const source: View = series.mode === 'equations' ? 'equations' : 'table'
  const fit = useAutoFit(series, model, source === 'table')
  const derivedTable = useMemo(() => (source === 'equations' ? tableFromEquations(series, model, 0) : null), [source, series, model])

  /** Drive the curve from equations (keeping the table's levels and range when coming from the table). */
  const driveFromEquations = (p: { meanExpr?: string; sdExpr?: string }, what: string) => {
    const best = (fits: Fit[] | undefined) => fits?.find((f) => f.ok && f.expr)?.expr
    clearMeasure()
    setLadder(null)
    patch({
      mode: 'equations',
      levels: normLevels(model.levels),
      cMax: model.cMax,
      meanExpr: p.meanExpr ?? best(fit.res?.meanFits) ?? series.meanExpr,
      sdExpr: p.sdExpr ?? best(fit.res?.sdFits) ?? series.sdExpr,
    })
    notify(`Equations now drive the curve (${what})`)
  }

  if (!open)
    return (
      <aside className="flex w-8 shrink-0 flex-col items-center border-r border-line pt-2">
        <button className="btn ghost" style={{ padding: '0 4px' }} onClick={() => setUi({ left: true })} title="Show inputs">
          <IconChevron dir="right" />
        </button>
        <span className="label mt-3 select-none" style={{ writingMode: 'vertical-rl' }}>
          Inputs
        </span>
      </aside>
    )

  const badge = (v: View) =>
    v === source ? (
      <span className="text-[10.5px] font-medium text-accent" title="This view defines the curve">
        ● drives the curve
      </span>
    ) : (
      <span className="text-[10.5px] text-muted" title="Shown live from the other view; editing here makes this view drive the curve">
        ○ {v === 'equations' ? 'fitted from the table' : 'from the equations'} · edit to drive
      </span>
    )

  const bestMean = fit.res?.meanFits.find((f) => f.ok && f.expr)
  const bestSd = fit.res?.sdFits.find((f) => f.ok && f.expr)

  return (
    <aside className="relative w-[304px] shrink-0">
      <div
        className="absolute inset-y-0 left-0 z-20 flex flex-col overflow-y-auto border-r border-line bg-bg p-3"
        style={{ width: wide ? 'min(60vw, 900px)' : '100%', transition: 'width 120ms ease-out' }}
      >
        <div className="mb-1 flex items-center justify-between">
          <Seg<View>
            value={view}
            options={[
              ['equations', 'Equations', 'μ(c) and σ(S) as formulas'],
              ['table', 'Table', 'concentrations across, readings (or mean / sd) below'],
            ]}
            onChange={(v) => setUi({ inputView: v })}
          />
          <button className="btn ghost" style={{ padding: '0 4px' }} onClick={() => setUi({ left: false })} title="Hide inputs">
            <IconChevron dir="left" />
          </button>
        </div>
        <div className="mb-3">{badge(view)}</div>

        {view === 'equations' &&
          (source === 'equations' ? (
            <EquationsEditor d={d} />
          ) : (
            // table drives: show the live fits; editing a formula (or picking a fit) makes the equations drive
            <div className="flex flex-col gap-3">
              {fit.err && <div className="text-[11px] text-bad">{fit.err}</div>}
              {!fit.res && !fit.err && <div className="text-[11px] text-muted">{fit.busy ? 'Fitting…' : 'Add data to the table to fit curves'}</div>}
              {fit.res && (
                <>
                  <ExprField
                    label="μ(c) ="
                    variable="c"
                    value={bestMean?.expr ?? ''}
                    presets={MEAN_PRESETS}
                    onCommit={(meanExpr) => meanExpr !== bestMean?.expr && driveFromEquations({ meanExpr }, 'edited μ(c)')}
                  />
                  <ExprField
                    label="σ(S) ="
                    variable="S"
                    value={bestSd?.expr ?? ''}
                    presets={SD_PRESETS}
                    onCommit={(sdExpr) => sdExpr !== bestSd?.expr && driveFromEquations({ sdExpr }, 'edited σ(S)')}
                  />
                  <div className="flex items-center gap-2">
                    <button className="btn" onClick={() => driveFromEquations({}, 'best fits')} title="Use the best fits as the equations that define the curve">
                      Drive from these fits
                    </button>
                    {fit.busy && <span className="text-[11px] text-muted">refitting…</span>}
                  </div>
                  <div className="flex flex-col gap-2 border-t border-line pt-2">
                    <span className="label">other fits · hover to preview</span>
                    <FitList title="μ(c)" fits={fit.res.meanFits} chosen={bestMean?.expr} onPick={(f) => driveFromEquations({ meanExpr: f.expr }, `${f.label} for μ(c)`)} />
                    <FitList title="σ(S)" fits={fit.res.sdFits} chosen={bestSd?.expr} onPick={(f) => driveFromEquations({ sdExpr: f.expr }, `${f.label} for σ(S)`)} />
                  </div>
                </>
              )}
            </div>
          ))}

        {view === 'table' && (
          <div className="flex flex-col gap-1.5">
            <QuickEntry
              table={derivedTable ?? tableOf(series)}
              onApply={(t, n) => {
                clearMeasure()
                setLadder(null)
                patch(fromTable(t))
                notify(`Added ${n} ${n === 1 ? 'column' : 'columns'}; the table now drives the curve`)
              }}
            />
            <TableEditor d={d} onFocusChange={setWide} data={derivedTable ?? undefined} />
            {source === 'equations' && series.sim.n > 0 && (
              <button
                className="link self-start text-[11px]"
                title="Make the table drive the curve, filled with simulated replicate readings (n and seed in Settings)"
                onClick={() => {
                  clearMeasure()
                  setLadder(null)
                  patch(fromTable(tableFromEquations(series, model, series.sim.n)))
                  notify(`Table filled with ${series.sim.n} simulated readings per level; the table now drives the curve`)
                }}
              >
                fill with simulated readings (n = {series.sim.n})
              </button>
            )}
          </div>
        )}
        {(series.layers ?? []).some((l) => l.on) && (
          <button className="link mt-4 self-start text-[11.5px]" onClick={() => setUi({ workspace: 'variability' })} title="The spread shown includes these layers; open the Variability workspace to change them">
            + {(series.layers ?? []).filter((l) => l.on).map((l) => l.name).join(', ')} variability included
          </button>
        )}
      </div>
    </aside>
  )
}
