import { useEffect, useMemo } from 'react'
import { CalibrationChart, HistogramChart, useLinkedSignalAxis } from './components/Charts'
import { LeftPanel } from './components/LeftPanel'
import { Explainer } from './components/Explainer'
import { PairPanel, selectedPair } from './components/PairPanel'
import { ReadPanel } from './components/ReadPanel'
import { Sentence } from './components/Sentence'
import { ImportDialog, StartDialog } from './components/StartDialog'
import { Toast } from './components/Toast'
import { TopBar } from './components/TopBar'
import { decodeShare, shareFromHash } from './share'
import { undoKey } from './state/keys'
import { importFile, importText } from './state/importData'
import { useDerived, type Derived } from './state/derived'
import { repeatRuns } from './state/repeat'
import { rulerPoints, sanitizeSeries, useStore } from './state/store'
import './theme'

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/**
 * The one screen (ideation/CORE_DESIGN.md): left = make and adjust the curve, middle = understand its separation
 * (curve, points, the selected pair or the histograms, one sentence), right = read values to concentrations.
 */
function CurveWorkspace({ d }: { d: Derived }) {
  const flip = useStore((s) => s.ui.flip)
  const reps = useStore((s) => s.ui.repeat)
  const measure = useStore((s) => s.measure)
  const explain = useStore((s) => s.ui.explain)
  useLinkedSignalAxis(flip)
  const pair = selectedPair(d, measure)
  const repeat = useMemo(() => {
    if (!reps) return null
    const pts = rulerPoints(measure, null).filter((c) => c > 0)
    const mid = pair?.hi ?? (pts.length ? pts[Math.floor((pts.length - 1) / 2)] : d.listed[Math.floor(d.listed.length / 2)])
    return repeatRuns(d.series, d.model, pts, reps, mid > 0 ? mid : null)
  }, [reps, d.series, d.model, d.listed, measure, pair?.hi])
  return (
    <>
      <LeftPanel d={d} />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-[260px] flex-[3] basis-0">
          <CalibrationChart d={d} repeat={repeat} />
        </div>
        {/* bottom quarter: the histograms or the selected pair, and the sentence */}
        <div className="flex min-h-[170px] flex-1 basis-0 flex-col border-t border-line">
          <div className="relative min-h-0 flex-1">{explain ? <Explainer d={d} pair={pair} /> : pair ? <PairPanel d={d} pair={pair} /> : <HistogramChart d={d} />}</div>
          <Sentence d={d} repeat={repeat} />
        </div>
      </main>
      <ReadPanel d={d} />
    </>
  )
}

export default function App() {
  const d = useDerived()
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
      if ((e.key === 'Backspace' || e.key === 'Delete') && !busy && st.measure) {
        e.preventDefault()
        return st.popMeasure()
      }
      if (!busy && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
        <div className="flex min-h-0 flex-1">
          <CurveWorkspace d={d} />
        </div>
        <Toast />
        {dialog === 'start' && <StartDialog />}
        {dialog === 'import' && <ImportDialog />}
      </div>
    </>
  )
}
