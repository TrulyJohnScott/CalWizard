/**
 * A tiny SVG chart kit for the workspaces and the report (spec §21). Plain SVG styled with the CSS variables, so the
 * same figures work on screen, in print and in the exported HTML report. No log axes.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { fmt } from '../format'

export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return [lo]
  const raw = (hi - lo) / Math.max(1, n)
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p
  const out: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12))
  return out
}

export const linePath = (pts: [number, number][]): string => {
  let d = ''
  let pen = false
  for (const [x, y] of pts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    pen = true
  }
  return d
}

/** Closed area between an upper and a lower polyline (same x order). */
export const areaPath = (top: [number, number][], bottom: [number, number][]): string => {
  const a = top.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  const b = bottom.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).reverse()
  if (!a.length || !b.length) return ''
  return `${linePath(a)}${b.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join('')}Z`
}

export const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
export const gaussPdf = (x: number, mu: number, sd: number) => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))

export interface Ctx {
  X: (v: number) => number
  Y: (v: number) => number
  /** pixel -> data */
  invX: (px: number) => number
  invY: (px: number) => number
  /** plot area in pixels */
  l: number
  t: number
  r: number
  b: number
  w: number
  h: number
}

/** Width of an element, measured; `fallback` until mounted (and in the static HTML export). */
export function useWidth<T extends HTMLElement>(fallback = 720): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => setW(Math.max(160, Math.round(el.clientWidth)))
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export interface ChartProps {
  height?: number
  /** fixed width (the report); measured when omitted */
  width?: number
  x: [number, number]
  y: [number, number]
  xLabel?: string
  yLabel?: string
  /** hide the y axis numbers (density plots) */
  bareY?: boolean
  xFormat?: (v: number) => string
  yFormat?: (v: number) => string
  children: (c: Ctx) => ReactNode
  /** rendered above the svg in the same box (HTML overlays) */
  overlay?: (c: Ctx) => ReactNode
  svgProps?: React.SVGProps<SVGSVGElement>
}

const T = { fontSize: 10.5, fill: 'var(--muted)', fontFamily: 'var(--font)' } as const

export function Chart({ height = 240, width, x, y, xLabel, yLabel, bareY, xFormat, yFormat, children, overlay, svgProps }: ChartProps) {
  const [ref, measured] = useWidth<HTMLDivElement>(width ?? 720)
  const W = width ?? measured
  const H = height
  const l = bareY ? 14 : 52
  const r = W - 14
  const t = 10
  const b = H - (xLabel ? 38 : 24)
  const sx = (r - l) / (x[1] - x[0] || 1)
  const sy = (b - t) / (y[1] - y[0] || 1)
  const c: Ctx = {
    X: (v) => l + (v - x[0]) * sx,
    Y: (v) => b - (v - y[0]) * sy,
    invX: (px) => x[0] + (px - l) / sx,
    invY: (px) => y[0] + (b - px) / sy,
    l,
    t,
    r,
    b,
    w: W,
    h: H,
  }
  const xt = niceTicks(x[0], x[1], Math.max(3, Math.floor((r - l) / 90)))
  const yt = bareY ? [] : niceTicks(y[0], y[1], Math.max(2, Math.floor((b - t) / 44)))
  const fx = xFormat ?? ((v: number) => fmt(v, 4))
  const fy = yFormat ?? ((v: number) => fmt(v, 4))
  return (
    <div ref={ref} style={{ position: 'relative', width: width ?? '100%', height: H }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }} {...svgProps}>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={l} x2={r} y1={c.Y(v)} y2={c.Y(v)} style={{ stroke: 'var(--grid)' }} />
            <text x={l - 6} y={c.Y(v) + 3.5} textAnchor="end" style={T}>
              {fy(v)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <g key={`x${v}`}>
            <line x1={c.X(v)} x2={c.X(v)} y1={b} y2={b + 3} style={{ stroke: 'var(--line)' }} />
            <text x={c.X(v)} y={b + 15} textAnchor="middle" style={T}>
              {fx(v)}
            </text>
          </g>
        ))}
        <line x1={l} x2={r} y1={b} y2={b} style={{ stroke: 'var(--line)' }} />
        {!bareY && <line x1={l} x2={l} y1={t} y2={b} style={{ stroke: 'var(--line)' }} />}
        {xLabel && (
          <text x={(l + r) / 2} y={H - 4} textAnchor="middle" style={{ ...T, fontSize: 11 }}>
            {xLabel}
          </text>
        )}
        {yLabel && !bareY && (
          <text transform={`translate(12 ${(t + b) / 2}) rotate(-90)`} textAnchor="middle" style={{ ...T, fontSize: 11 }}>
            {yLabel}
          </text>
        )}
        {children(c)}
      </svg>
      {overlay?.(c)}
    </div>
  )
}

/** A small text label with a panel-coloured halo so it stays readable over lines. */
export function Label({ x, y, children, anchor = 'middle', color = 'var(--fg)', size = 11, weight = 500 }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; color?: string; size?: number; weight?: number }) {
  return (
    <text x={x} y={y} textAnchor={anchor} style={{ fontSize: size, fontWeight: weight, fill: color, fontFamily: 'var(--font)', paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 3, strokeLinejoin: 'round' }}>
      {children}
    </text>
  )
}

/** Tiny curve thumbnail (gallery cards). */
export function Spark({ f, band, x1, w = 120, h = 44 }: { f: (c: number) => number; band?: (c: number) => number; x1: number; w?: number; h?: number }) {
  const cs = linspace(0, x1, 60)
  const ys = cs.map(f)
  const sd = band ? cs.map(band) : cs.map(() => 0)
  const lo = Math.min(...ys.map((v, i) => v - 2 * sd[i]).filter(Number.isFinite))
  const hi = Math.max(...ys.map((v, i) => v + 2 * sd[i]).filter(Number.isFinite))
  const X = (c: number) => 2 + ((w - 4) * c) / x1
  const Y = (v: number) => h - 3 - ((h - 6) * (v - lo)) / (hi - lo || 1)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {band && <path d={areaPath(cs.map((c, i) => [X(c), Y(ys[i] + 2 * sd[i])]), cs.map((c, i) => [X(c), Y(ys[i] - 2 * sd[i])]))} style={{ fill: 'var(--accent)', opacity: 0.14 }} />}
      <path d={linePath(cs.map((c, i) => [X(c), Y(ys[i])]))} style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 1.6 }} />
    </svg>
  )
}
