/**
 * Bringing data in (spec §19, §21): one entry point for text that was pasted, dropped or picked as a file. It
 * recognises a saved series (JSON or an exported report), a reader export, and the plain table layouts; a reader
 * export with several possible signal columns opens the import dialog instead of guessing silently.
 */
import { parseReader, type ReaderImport } from '../math/reader'
import { fromTable, parseAnyBlock } from '../math/table'
import type { Series } from '../math/types'
import { seriesFromReport } from '../share'
import { sanitizeSeries, useStore } from './store'

/** Series fields for a parsed reader export (the table drives the curve; labels come from the headers). */
export function readerPatch(p: ReaderImport): Partial<Series> {
  const t = fromTable({ concs: p.concs, cells: p.cells, typed: p.concs.map(() => ({ mean: null, sd: null })) })
  const top = Math.max(0, ...p.concs)
  return { ...t, extraLevels: [], adjust: null, ...(top > 0 ? { cMax: top } : {}), ...(p.units ? { units: p.units } : {}), ...(p.signalLabel ? { signalLabel: p.signalLabel } : {}) }
}

export function applyReader(p: ReaderImport, name?: string): void {
  const st = useStore.getState()
  st.clearMeasure()
  st.setLadder(null)
  st.patch({ ...readerPatch(p), ...(name ? { name } : {}) })
  st.setUi({ left: true, inputView: 'table' })
  const n = p.cells.reduce((a, c) => a + c.length, 0)
  st.notify(`Imported ${n} readings at ${p.concs.filter((_, j) => p.cells[j].length).length} concentrations${p.signalLabel ? ` (${p.signalLabel})` : ''}`)
}

/** True when something was recognised (and applied or handed to the import dialog). */
export function importText(text: string, name?: string): boolean {
  const st = useStore.getState()
  const head = text.trimStart().slice(0, 16).toLowerCase()
  if (head.startsWith('{') || head.startsWith('<!doctype') || head.startsWith('<html')) {
    let raw: unknown = null
    try {
      raw = head.startsWith('{') ? JSON.parse(text) : seriesFromReport(text)
    } catch {
      raw = null
    }
    if (raw && typeof raw === 'object') {
      const inner = (raw as { series?: unknown }).series
      const loaded = sanitizeSeries(inner && typeof inner === 'object' ? inner : raw)
      st.replaceActive(loaded)
      st.openDialog(null)
      st.notify(`Loaded “${loaded.name}”`)
      return true
    }
    return false
  }
  const reader = parseReader(text)
  if (reader) {
    const choices = reader.columns.filter((c) => c.role === 'signal' || c.role === 'candidate').length
    if (choices > 1 && reader.signalCols.length === 1) st.openDialog('import', text)
    else {
      applyReader(reader, name)
      st.openDialog(null)
    }
    return true
  }
  const table = parseAnyBlock(text)
  if (table) {
    st.clearMeasure()
    st.setLadder(null)
    st.patch({ ...fromTable(table), ...(name ? { name } : {}) })
    st.setUi({ left: true, inputView: 'table' })
    st.openDialog(null)
    st.notify(`Pasted a table with ${table.concs.filter((c) => c !== null).length} concentrations`)
    return true
  }
  return false
}

export async function importFile(f: File): Promise<boolean> {
  const text = await f.text()
  const ok = importText(text, f.name.replace(/\.[^.]+$/, '').replace(/\.calwizard$/, ''))
  if (!ok) useStore.getState().notify(`Could not find a table or a saved assay in ${f.name}`, false)
  return ok
}
