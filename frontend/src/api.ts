import type { Series } from './math/types'

/** Strip frontend-only fields before sending a series to the backend. */
export function toWire(s: Series & { id?: string }): Series {
  const { id: _id, ...rest } = s
  void _id
  return rest
}

export interface Fit {
  kind: string
  label: string
  params: Record<string, number>
  expr: string
  r2: number | null
  aicc: number | null
  ok: boolean
}
export interface FitResult {
  levels: { c: number; mean: number; sd: number | null; n: number }[]
  meanFits: Fit[]
  sdFits: Fit[]
}

export async function fitData(body: { points?: { c: number; y: number }[]; summary?: { c: number; mean: number; sd: number | null }[] }): Promise<FitResult> {
  const r = await fetch('/api/fit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`fit failed (${r.status})`)
  return (await r.json()) as FitResult
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const safeName = (n: string) => n.replace(/[^\w.-]+/g, '_') || 'series'

export async function exportExcel(series: Series): Promise<void> {
  const r = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: toWire(series) }) })
  if (!r.ok) throw new Error(`Export failed (${r.status})`)
  const cd = r.headers.get('content-disposition') ?? ''
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)
  download(await r.blob(), m ? decodeURIComponent(m[1]) : `calwizard_${safeName(series.name)}.xlsx`)
}

export function saveJson(series: Series) {
  download(new Blob([JSON.stringify(toWire(series), null, 2)], { type: 'application/json' }), `${safeName(series.name)}.calwizard.json`)
}
