/**
 * Presentation mode (spec §21): the report full-screen, nothing editable. Arrow keys / Page keys step through its
 * sections; the same view prints and saves as a single HTML file.
 */
import { useEffect, useRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { download } from '../api'
import { shareUrl, reportDocument } from '../share'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { usePalette } from '../theme'
import { Report, REPORT_CSS } from './Report'

const today = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const safeName = (n: string) => n.replace(/[^\w.-]+/g, '_') || 'assay'

/** Save the report as one self-contained HTML file (always the light, print-friendly look). */
export async function saveReportHtml(d: Derived, pair: { a: number; b: number } | null) {
  const body = renderToStaticMarkup(<Report d={d} opt={{ static: true, pair, date: today() }} />)
  const link = await shareUrl(d.series)
  const html = reportDocument(`${d.series.name || 'Assay'} · Cal Wizard`, body, REPORT_CSS, d.series, link)
  download(new Blob([html], { type: 'text/html' }), `${safeName(d.series.name)}.calwizard.html`)
}

export async function copyShareLink(d: Derived): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(await shareUrl(d.series))
    return true
  } catch {
    return false
  }
}

export function Present({ d }: { d: Derived }) {
  const setPresent = useStore((s) => s.setPresent)
  const notify = useStore((s) => s.notify)
  const pair = useStore((s) => s.ui.sep)
  const pal = usePalette()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const step = (dir: 1 | -1) => {
      const el = box.current
      if (!el) return
      const tops = [...el.querySelectorAll<HTMLElement>('[data-slide]')].map((x) => x.offsetTop)
      const y = el.scrollTop + 8
      const next = dir > 0 ? tops.find((t) => t > y + 40) : [...tops].reverse().find((t) => t < y - 40)
      if (next !== undefined) el.scrollTo({ top: next - 24, behavior: 'smooth' })
    }
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setPresent(false)
      } else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault()
        step(1)
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        step(-1)
      }
    }
    window.addEventListener('keydown', k, true)
    document.body.classList.add('presenting')
    return () => {
      window.removeEventListener('keydown', k, true)
      document.body.classList.remove('presenting')
    }
  }, [setPresent])
  return (
    <div ref={box} className="present fixed inset-0 z-50 overflow-y-auto overflow-x-hidden" style={{ background: 'var(--bg)' }}>
      <style>{REPORT_CSS}</style>
      <div className="present-bar sticky top-0 z-10 flex items-center justify-end gap-1.5 px-4 py-2">
        <span className="label mr-2">← → to step · Esc to leave</span>
        <button
          className="btn"
          onClick={async () => notify((await copyShareLink(d)) ? 'Link copied: it holds the whole assay, nothing is uploaded' : 'Could not copy the link', false)}
        >
          Copy link
        </button>
        <button className="btn" onClick={() => void saveReportHtml(d, pair)} title="One self-contained file anyone can open in a browser">
          Save HTML
        </button>
        <button className="btn" onClick={() => window.print()} title="Print, or save as PDF from the print dialog">
          Print
        </button>
        <button className="btn" onClick={() => setPresent(false)}>
          Done
        </button>
      </div>
      <div className="present-zoom">
        <Report d={d} opt={{ dark: pal.dark, pair, date: today() }} />
      </div>
    </div>
  )
}
