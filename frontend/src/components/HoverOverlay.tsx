import { useEffect, useState, type RefObject } from 'react'
import { fmt } from '../format'
import { concDist, signalDist, type HistSpace } from '../charts/histogram'
import type { Model } from '../math/model'
import { useStore } from '../state/store'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Hover drawings live on a thin SVG layer over each chart, positioned with the chart's own axis transforms, so moving
 * the mouse redraws a few paths instead of re-rendering the Plotly figures (spec §11 v2.4: smooth hover).
 */
function useAxes(ref: RefObject<HTMLDivElement | null>) {
  const [, bump] = useState(0)
  // re-read axes whenever Plotly finishes a redraw (zoom, resize, data change)
  useEffect(() => {
    let el: any = null
    let timer = 0
    const on = () => bump((n) => n + 1)
    const attach = () => {
      el = ref.current as any
      if (!el?.on) {
        timer = window.setTimeout(attach, 200)
        return
      }
      el.on('plotly_afterplot', on)
    }
    attach()
    return () => {
      clearTimeout(timer)
      el?.removeListener?.('plotly_afterplot', on)
    }
  }, [ref])
  const fl = (ref.current as any)?._fullLayout
  if (!fl?.xaxis || !fl?.yaxis) return null
  const xa = fl.xaxis
  const ya = fl.yaxis
  return {
    X: (v: number) => xa._offset + xa.d2p(v),
    Y: (v: number) => ya._offset + ya.d2p(v),
    box: { x: xa._offset, y: ya._offset, w: xa._length, h: ya._length },
    xr: xa.range as [number, number],
    yr: ya.range as [number, number],
  }
}

const path = (pts: [number, number][]) => pts.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('')

/** Scatter: dotted guides from both axes to the curve + a dashed sideways Gaussian at the hovered concentration. */
export function ScatterHover({ plot, model, listed, flip, onCurve }: { plot: RefObject<HTMLDivElement | null>; model: Model; listed: number[]; flip: boolean; onCurve: boolean }) {
  const probe = useStore((s) => s.probe)
  const ax = useAxes(plot)
  if (!ax || probe === null) return null
  const mu = model.mean(probe)
  const sd = model.sd(probe)
  if (!Number.isFinite(mu)) return null
  const P = (c: number, S: number): [number, number] => (flip ? [ax.X(S), ax.Y(c)] : [ax.X(c), ax.Y(S)])
  const cLo = flip ? ax.yr[0] : ax.xr[0]
  const sLo = flip ? ax.xr[0] : ax.yr[0]
  const guideC = path([P(probe, sLo), P(probe, mu)])
  const guideS = path([P(cLo, mu), P(probe, mu)])
  let bump = ''
  if (onCurve && sd > 0) {
    // same scale as the level Gaussians: the tightest level spans 7% of the concentration axis
    const span = Math.abs((flip ? ax.yr[1] - ax.yr[0] : ax.xr[1] - ax.xr[0]) || 1)
    const sdRef = Math.min(sd, ...listed.map((c) => model.sd(c)).filter((v) => v > 0 && Number.isFinite(v)))
    const w = 0.07 * span * (sdRef / sd)
    const pts: [number, number][] = []
    for (let i = 0; i <= 60; i++) {
      const y = mu - 3.5 * sd + (7 * sd * i) / 60
      pts.push(P(probe + w * Math.exp(-0.5 * ((y - mu) / sd) ** 2), y))
    }
    bump = path(pts)
  }
  return (
    <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-visible">
      <defs>
        <clipPath id="scatter-hover-clip">
          <rect x={ax.box.x} y={ax.box.y} width={ax.box.w} height={ax.box.h} />
        </clipPath>
      </defs>
      <g clipPath="url(#scatter-hover-clip)" fill="none">
        <path d={guideC} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />
        <path d={guideS} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />
        {bump && <path d={bump} stroke="var(--fg)" strokeWidth={1.1} strokeDasharray="5 4" />}
      </g>
    </svg>
  )
}

/** Histogram: dashed density of the hovered concentration on the same scale as the chart's curves. */
export function HistHover({ plot, model, space, xRange, top, skip }: { plot: RefObject<HTMLDivElement | null>; model: Model; space: HistSpace; xRange: [number, number]; top: number; skip: number[] }) {
  const probe = useStore((s) => s.probe)
  const ax = useAxes(plot)
  if (!ax || probe === null || skip.includes(probe)) return null
  const d = space === 'signal' ? signalDist(model, probe) : concDist(model, probe, xRange)
  if (!d) return null
  const step = Math.max(1, Math.floor(d.xs.length / 160))
  const pts = d.xs.filter((_, i) => i % step === 0).map((x): [number, number] => [ax.X(x), ax.Y(d.f(x) / top)])
  const peakY = ax.Y(Math.min(1.1, d.peak / top))
  return (
    <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-visible">
      <defs>
        <clipPath id="hist-hover-clip">
          <rect x={ax.box.x} y={ax.box.y - 20} width={ax.box.w} height={ax.box.h + 20} />
        </clipPath>
      </defs>
      <g clipPath="url(#hist-hover-clip)">
        <path d={path(pts)} fill="none" stroke="var(--fg)" strokeWidth={1.2} strokeDasharray="5 4" />
        <text x={ax.X(d.mode)} y={peakY - 5} textAnchor="middle" fontSize={9.5} fill="var(--fg)">
          c {fmt(probe)}
        </text>
      </g>
    </svg>
  )
}
