import { useEffect, useRef } from 'react'
import type { Config, Data, Layout } from 'plotly.js'

interface PlotlyLib {
  react: (el: HTMLElement, data: Data[], layout: Partial<Layout>, config?: Partial<Config>) => Promise<unknown>
  animate: (el: HTMLElement, frame: { data: Data[]; layout: Partial<Layout> }, opts: object) => Promise<unknown>
  purge: (el: HTMLElement) => void
  relayout: (el: HTMLElement, update: Record<string, unknown>) => Promise<unknown>
  Plots: { resize: (el: HTMLElement) => void }
}

let lib: Promise<PlotlyLib> | null = null
/** Lazy-load Plotly so first paint stays fast. */
export const loadPlotly = (): Promise<PlotlyLib> =>
  (lib ??= import('plotly.js-dist-min').then((m) => ((m as unknown as { default?: PlotlyLib }).default ?? (m as unknown)) as PlotlyLib))

export interface PlotSpec {
  data: Data[]
  layout: Partial<Layout>
  /** When this key changes between updates, the update is animated (axis flip). */
  animateKey?: string
}

const CONFIG: Partial<Config> = {
  displaylogo: false,
  responsive: true,
  displayModeBar: 'hover',
  modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toImage', 'hoverClosestCartesian', 'hoverCompareCartesian'],
  doubleClick: false, // the app resets to ranges computed from the current data (spec §11 v2.4)
  scrollZoom: false,
}

/**
 * Drives a Plotly div with Plotly.react (never newPlot per update). Updates are coalesced to one
 * per animation frame so slider drags stay smooth.
 */
export function usePlot(spec: PlotSpec) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(spec)
  latest.current = spec
  const st = useRef<{ P: PlotlyLib | null; raf: number; tm: ReturnType<typeof setTimeout> | 0; key?: string; drawn: boolean }>({ P: null, raf: 0, tm: 0, drawn: false })

  const flush = () => {
    cancelAnimationFrame(st.current.raf)
    clearTimeout(st.current.tm)
    st.current.raf = 0
    st.current.tm = 0
    const { P } = st.current
    const el = ref.current
    if (!P || !el) return
    const { data, layout, animateKey } = latest.current
    const s = st.current
    if (s.drawn && animateKey !== undefined && s.key !== undefined && animateKey !== s.key) {
      // axis flip: quick cross-fade through the swap (Plotly.animate cannot swap tick sets)
      s.key = animateKey
      el.style.transition = 'opacity 150ms ease-out, transform 150ms ease-out'
      el.style.opacity = '0.15'
      el.style.transform = 'scale(0.992)'
      setTimeout(() => {
        const cur = latest.current
        P.react(el, cur.data, cur.layout, CONFIG).catch((e) => console.error('[plot]', e))
        el.style.transition = 'opacity 260ms ease-in, transform 260ms ease-in'
        el.style.opacity = '1'
        el.style.transform = 'none'
      }, 150)
    } else {
      s.key = animateKey
      s.drawn = true
      P.react(el, data, layout, CONFIG).catch((e) => console.error('[plot]', e))
    }
  }
  const schedule = () => {
    if (st.current.raf || st.current.tm) return
    st.current.raf = requestAnimationFrame(flush)
    // rAF is paused in background tabs; fall back to a timer so updates never stall
    st.current.tm = setTimeout(flush, 60)
  }

  useEffect(() => {
    let dead = false
    const el = ref.current
    loadPlotly().then((P) => {
      if (dead) return
      st.current.P = P
      schedule()
    }).catch((e) => console.error('[plotly load]', e))
    const ro = new ResizeObserver(() => {
      const { P } = st.current
      if (P && el && st.current.drawn) P.Plots.resize(el)
    })
    if (el) ro.observe(el)
    return () => {
      dead = true
      ro.disconnect()
      cancelAnimationFrame(st.current.raf)
      clearTimeout(st.current.tm)
      st.current.raf = 0
      st.current.tm = 0
      if (st.current.P && el) st.current.P.purge(el)
      st.current.drawn = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(schedule, [spec])
  return ref
}
