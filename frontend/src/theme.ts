import { useEffect, useState } from 'react'
import { useStore, type Theme } from './state/store'

export function applyTheme(theme: Theme) {
  const el = document.documentElement
  if (theme === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', theme)
}

applyTheme(useStore.getState().ui.theme)
let prev = useStore.getState().ui.theme
useStore.subscribe((s) => {
  if (s.ui.theme !== prev) {
    prev = s.ui.theme
    applyTheme(prev)
  }
})

export interface Palette {
  dark: boolean
  fg: string
  muted: string
  line: string
  grid: string
  panel: string
  accent: string
  bad: string
  warm: string
  font: string
}

function read(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  return {
    dark: cs.colorScheme.includes('dark'),
    fg: v('--fg'),
    muted: v('--muted'),
    line: v('--line'),
    grid: v('--grid'),
    panel: v('--panel'),
    accent: v('--accent'),
    bad: v('--bad'),
    warm: v('--warm'),
    font: v('--font'),
  }
}

/** Palette resolved from CSS variables; re-reads on theme toggle / OS change. */
export function usePalette(): Palette {
  const theme = useStore((s) => s.ui.theme)
  const [pal, setPal] = useState<Palette>(read)
  useEffect(() => {
    // wait a frame so data-theme has been applied
    const id = requestAnimationFrame(() => setPal(read()))
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setPal(read())
    mq.addEventListener('change', on)
    return () => {
      cancelAnimationFrame(id)
      mq.removeEventListener('change', on)
    }
  }, [theme])
  return pal
}

/** Sequential hue per level (violet -> teal), muted. */
export function levelColor(i: number, n: number, dark: boolean, alpha = 1): string {
  const t = n <= 1 ? 0 : i / (n - 1)
  const h = 262 - 100 * t
  return `hsla(${h.toFixed(0)}, 48%, ${dark ? 68 : 50}%, ${alpha})`
}

const STOPS: [number, number, number][] = [
  [59, 130, 196],
  [232, 196, 104],
  [217, 83, 79],
]
/** Overlap in [0,1] -> [r,g,b], cool blue (separated) to hot red (overlapping). */
export function heatRgb(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  const i = x < 0.5 ? 0 : 1
  const u = (x - i * 0.5) / 0.5
  const a = STOPS[i]
  const b = STOPS[i + 1]
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * u)) as [number, number, number]
}
export const HEAT_COLORSCALE: [number, string][] = [
  [0, 'rgb(59,130,196)'],
  [0.5, 'rgb(232,196,104)'],
  [1, 'rgb(217,83,79)'],
]

/** "#rrggbb" or hsl()/hsla()/rgb() strings with a replaced alpha. */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim()
  if (c.startsWith('#') && c.length === 7) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
    return `rgba(${r},${g},${b},${alpha})`
  }
  const m = /^(hsla?|rgba?)\(([^)]+)\)$/.exec(c)
  if (m) {
    const parts = m[2].split(',').slice(0, 3).join(',')
    return `${m[1].startsWith('hsl') ? 'hsla' : 'rgba'}(${parts},${alpha})`
  }
  return c
}
