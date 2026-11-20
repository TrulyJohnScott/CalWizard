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

export interface DialInResult {
  perConc: { c: number; n: number; mean: number; within: number; layers: Record<string, number> }[]
  layers: { name: string; units: number; rough: [number, number] | null; measured: { offsetSd: number; cv: number; gainCv: number }; predicted: { offsetSd: number; cv: number; gainCv: number } }[]
  within: { c: number; measured: number; predicted: number }[]
  notes: string[]
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let r: Response
  try {
    r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new Error('needs the API server (port 8000)')
  }
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.detail?.error ?? `HTTP ${r.status}`)
  return j as T
}

/** Spec §22.4: measured layer sizes from pasted CSV (c,<layer names>,y). */
export const dialIn = (series: Series, csv: string) => post<DialInResult>('/api/dialin', { series: toWire(series), csv })

export interface DesignResult {
  concs: number[]
  n: number
  units: number[]
  readingsPerConc: number
  runs: number
  componentsAt: number
  pairs: { c1: number; c2: number; pPass: number; pSig: number; lo: number | null; med: number | null; hi: number | null }[]
  components: { name: string; true: number; lo: number | null; med: number | null; hi: number | null }[]
}

/** Spec §22.3: experiments drawing actual units of every layer. */
export const designRun = (series: Series, concs: number[], n: number, runs: number, seed: number) =>
  post<DesignResult>('/api/design', { series: toWire(series), concs, n, runs, seed })
