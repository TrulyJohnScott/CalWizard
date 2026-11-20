import { useState } from 'react'
import { fromTable, hasReplicateData, tableFromEquations, toTable as tableOf } from '../math/table'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { EquationsEditor } from './EquationsEditor'
import { FitPanel } from './FitPanel'
import { QuickEntry, TableEditor } from './TableEditor'
import { IconChevron, Seg } from './ui'

type View = 'equations' | 'table'

/** Left panel: define the functions (Equations or Table). Widens over the centre while the grid has focus. */
export function LeftPanel({ d }: { d: Derived }) {
  const open = useStore((s) => s.ui.left)
  const setUi = useStore((s) => s.setUi)
  const patch = useStore((s) => s.patch)
  const setLadder = useStore((s) => s.setLadder)
  const clearMeasure = useStore((s) => s.clearMeasure)
  const notify = useStore((s) => s.notify)
  const [wide, setWide] = useState(false)
  const { series, model } = d
  const view: View = series.mode === 'equations' ? 'equations' : 'table'

  const setView = (v: View) => {
    clearMeasure()
    setLadder(null)
    if (v === 'equations') patch({ mode: 'equations' })
    else patch({ mode: hasReplicateData(series) ? 'replicates' : 'summary' })
  }
  const toTable = (n: number) => {
    clearMeasure()
    setLadder(null)
    patch(fromTable(tableFromEquations(series, model, n)))
    notify('Table filled from the equations')
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
  return (
    <aside className="relative w-[304px] shrink-0">
      <div
        className="absolute inset-y-0 left-0 z-20 flex flex-col overflow-y-auto border-r border-line bg-bg p-3"
        style={{ width: wide ? 'min(60vw, 900px)' : '100%', transition: 'width 120ms ease-out' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <Seg<View>
            value={view}
            options={[
              ['equations', 'Equations'],
              ['table', 'Table'],
            ]}
            onChange={setView}
          />
          <button className="btn ghost" style={{ padding: '0 4px' }} onClick={() => setUi({ left: false })} title="Hide inputs">
            <IconChevron dir="left" />
          </button>
        </div>
        {view === 'equations' ? (
          <>
            <EquationsEditor d={d} />
            <div className="mt-3 flex items-center gap-3">
              <button className="btn" onClick={() => toTable(0)} title="Fill the table: levels across the top, mean and sd from the equations">
                Equations → Table
              </button>
              {series.sim.n > 0 && (
                <button className="link" onClick={() => toTable(series.sim.n)} title="Fill the table with simulated replicates (n and seed in Settings)">
                  with n={series.sim.n}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <QuickEntry
              table={tableOf(series)}
              onApply={(t, n) => {
                clearMeasure()
                setLadder(null)
                patch(fromTable(t))
                notify(`Added ${n} ${n === 1 ? 'column' : 'columns'} to the table`)
              }}
            />
            <TableEditor d={d} onFocusChange={setWide} />
          </div>
        )}
        <div className="mt-3">
          <FitPanel d={d} showButton={view === 'table'} />
        </div>
      </div>
    </aside>
  )
}
