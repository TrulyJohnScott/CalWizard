import { useEffect } from 'react'
import { CalibrationChart, HistogramChart, useLinkedSignalAxis } from './components/Charts'
import { LeftPanel } from './components/LeftPanel'
import { LevelsSidebar } from './components/LevelsSidebar'
import { LimitsWorkspace } from './components/LimitsWorkspace'
import { Present } from './components/Present'
import { ReadWorkspace } from './components/ReadWorkspace'
import { RequirementsWorkspace } from './components/RequirementsWorkspace'
import { SeparateWorkspace } from './components/SeparateWorkspace'
import { ImportDialog, StartDialog } from './components/StartDialog'
import { StripsWorkspace } from './components/StripsWorkspace'
import { VariabilityWorkspace } from './components/VariabilityWorkspace'
import { Toast } from './components/Toast'
import { TopBar, WORKSPACES } from './components/TopBar'
import { WhatIfBar } from './components/WhatIfBar'
import { decodeShare, shareFromHash } from './share'
import { undoKey } from './state/keys'
import { importFile, importText } from './state/importData'
import { useDerived, type Derived } from './state/derived'
import { sanitizeSeries, useStore } from './state/store'
import './theme'

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** The original three-pane view: inputs, the two linked charts, levels. */
function CurveWorkspace({ d }: { d: Derived }) {
  const flip = useStore((s) => s.ui.flip)
  useLinkedSignalAxis(flip)
  return (
    <>
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
    </>
  )
}

export default function App() {
  const d = useDerived()
  const ws = useStore((s) => s.ui.workspace)
  const whatIf = useStore((s) => s.ui.whatIf)
  const present = useStore((s) => s.present)
  const dialog = useStore((s) => s.dialog)

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const st = useStore.getState()
      if (st.present || st.dialog) return // those views own the keyboard
      if (e.key === 'Escape') {
        if (st.measure?.sel !== null && st.measure?.sel !== undefined) return st.selectMeasure(null)
        st.setReading(null)
        return st.clearMeasure()
      }
      const busy = typing(e.target)
      if ((e.key === 'Backspace' || e.key === 'Delete') && !busy && st.measure && st.ui.workspace === 'curve') {
        e.preventDefault()
        return st.popMeasure()
      }
      if (!busy && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const i = '1234567'.indexOf(e.key)
        if (i >= 0 && e.key.length === 1) return st.setUi({ workspace: WORKSPACES[i].id })
        if (e.key === 'p' || e.key === 'P') return st.setPresent(true)
        if (e.key === 'w' || e.key === 'W') return st.setUi({ whatIf: !st.ui.whatIf })
      }
      const action = undoKey(e)
      if (!action) return
      e.preventDefault()
      st[action]()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  // paste a table or a reader export anywhere (not into a text field): recognised, one undo step, toast
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (typing(t) || t?.closest?.('.gdg-wmyidgi, [data-testid="data-grid-canvas"]')) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text.trim() && importText(text)) e.preventDefault()
    }
    // drop a file anywhere: reader export, saved JSON, or an exported report
    const onDrag = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0]
      if (!f) return
      e.preventDefault()
      void importFile(f)
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onDrag)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onDrag)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // a shared link carries the whole series in the hash
  useEffect(() => {
    const payload = shareFromHash(location.hash)
    if (!payload) return
    void decodeShare(payload).then((raw) => {
      if (!raw) return
      const loaded = sanitizeSeries(raw)
      const st = useStore.getState()
      st.replaceActive(loaded)
      st.notify(`Opened “${loaded.name}” from a link`)
      history.replaceState(null, '', location.pathname + location.search)
    })
  }, [])

  return (
    <>
      <div className="app-shell flex h-full flex-col">
        <TopBar d={d} />
        {whatIf && <WhatIfBar d={d} />}
        <div className="flex min-h-0 flex-1" key={ws}>
          {ws === 'curve' && <CurveWorkspace d={d} />}
          {ws === 'separate' && <SeparateWorkspace d={d} />}
          {ws === 'limits' && <LimitsWorkspace d={d} />}
          {ws === 'read' && <ReadWorkspace d={d} />}
          {ws === 'requirements' && <RequirementsWorkspace d={d} />}
          {ws === 'variability' && <VariabilityWorkspace d={d} />}
          {ws === 'strips' && <StripsWorkspace d={d} />}
        </div>
        <Toast />
        {dialog === 'start' && <StartDialog />}
        {dialog === 'import' && <ImportDialog />}
      </div>
      {present && <Present d={d} />}
    </>
  )
}
