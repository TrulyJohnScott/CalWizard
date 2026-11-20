import { useEffect } from 'react'
import { CalibrationChart, HistogramChart, useLinkedSignalAxis } from './components/Charts'
import { LeftPanel } from './components/LeftPanel'
import { LevelsSidebar } from './components/LevelsSidebar'
import { Toast } from './components/Toast'
import { TopBar } from './components/TopBar'
import { undoKey } from './state/keys'
import { fromTable, parseAnyBlock } from './math/table'
import { useDerived } from './state/derived'
import { useStore } from './state/store'
import './theme'

export default function App() {
  const d = useDerived()
  const flip = useStore((s) => s.ui.flip)
  const clearMeasure = useStore((s) => s.clearMeasure)
  useLinkedSignalAxis(flip)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useStore.getState().setReading(null)
        return clearMeasure()
      }
      const action = undoKey(e)
      if (!action) return
      e.preventDefault()
      useStore.getState()[action]()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [clearMeasure])
  // paste a table anywhere (not into a text field): layout is recognised, one undo step, toast
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      if (t?.closest?.('.gdg-wmyidgi, [data-testid="data-grid-canvas"]')) return // the grid handles its own paste
      const text = e.clipboardData?.getData('text/plain') ?? ''
      const table = parseAnyBlock(text)
      if (!table) return
      e.preventDefault()
      const st = useStore.getState()
      st.clearMeasure()
      st.setLadder(null)
      st.patch(fromTable(table))
      st.setUi({ left: true })
      const n = table.concs.filter((c) => c !== null).length
      st.notify(`Pasted a table with ${n} concentrations`)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TopBar d={d} />
      <div className="flex min-h-0 flex-1">
        <LeftPanel d={d} />
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="relative min-h-[240px] flex-[2]">
            <CalibrationChart d={d} />
          </div>
          <div className="relative min-h-[150px] flex-1 border-t border-line">
            <HistogramChart d={d} />
          </div>
        </main>
        <LevelsSidebar d={d} />
      </div>
      <Toast />
    </div>
  )
}
