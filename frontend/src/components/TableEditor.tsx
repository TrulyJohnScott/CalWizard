import { DataEditor, GridCellKind, type GridCell, type GridColumn, type Item, type Theme } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fmt } from '../format'
import { parseNum } from '../math/tables'
import { columnStats, fromTable, mergeQuick, parseQuick, pasteWhole, setTableCell, toTable, type CellRef, type TableData } from '../math/table'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { usePalette, withAlpha } from '../theme'

const ROW_H = 24
const LABEL_W = 48
const COL_W = 64

/** Map a grid position to a table cell (null = label column / read-only area). */
function refOf(col: number, row: number, reps: number): CellRef | null {
  if (col < 1) return null
  const j = col - 1
  if (row === 0) return { kind: 'conc', j }
  if (row <= reps) return { kind: 'rep', j, i: row - 1 }
  return { kind: row === reps + 1 ? 'mean' : 'sd', j }
}

/**
 * One Excel-like grid (Glide Data Grid): concentrations across the top, replicate rows below, then
 * computed mean / sd rows (typed directly when a column has no replicates). No +/x buttons: typing in
 * the spare edge column / row grows the table.
 */
export function TableEditor({ d, onFocusChange }: { d: Derived; onFocusChange: (focused: boolean) => void }) {
  const patch = useStore((s) => s.patch)
  const setLadder = useStore((s) => s.setLadder)
  const clearMeasure = useStore((s) => s.clearMeasure)
  const pal = usePalette()
  const table = useMemo(() => toTable(d.series), [d.series])
  const stats = useMemo(() => columnStats(table), [table])
  const maxLen = Math.max(0, ...table.cells.map((c) => c.length))
  const reps = maxLen + 1 // exactly one spare replicate row
  const cols = table.concs.length + 1 // and one spare column
  const rows = reps + 3

  const live = useRef({ table, reps })
  live.current = { table, reps }
  const wrap = useRef<HTMLDivElement>(null)

  const commit = useCallback(
    (t: TableData) => {
      patch(fromTable(t))
      setLadder(null)
      clearMeasure()
    },
    [patch, setLadder, clearMeasure],
  )

  const columns = useMemo<GridColumn[]>(
    () => [{ id: 'label', title: '', width: LABEL_W }, ...Array.from({ length: cols }, (_, j) => ({ id: `c${j}`, title: '', width: COL_W }))],
    [cols],
  )

  const theme = useMemo<Partial<Theme>>(
    () => ({
      bgCell: pal.panel,
      bgCellMedium: pal.grid,
      bgHeader: pal.grid,
      bgHeaderHasFocus: pal.grid,
      bgHeaderHovered: pal.grid,
      textDark: pal.fg,
      textMedium: pal.muted,
      textLight: pal.muted,
      textHeader: pal.muted,
      borderColor: pal.line,
      horizontalBorderColor: pal.line,
      accentColor: pal.accent,
      accentLight: withAlpha(pal.accent, 0.14),
      accentFg: '#ffffff',
      fontFamily: pal.font,
      baseFontStyle: '12px',
      headerFontStyle: '600 12px',
      editorFontSize: '12px',
      cellHorizontalPadding: 6,
      cellVerticalPadding: 2,
      textBubble: pal.fg,
      bgBubble: pal.grid,
    }),
    [pal],
  )

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const { table: t, reps: R } = live.current
      if (col === 0) {
        const label = row === 0 ? 'c' : row === R + 1 ? 'mean' : row === R + 2 ? 'sd' : row === R ? '+' : String(row)
        return { kind: GridCellKind.Text, data: label, displayData: label, allowOverlay: false, readonly: true, themeOverride: { textDark: pal.muted, bgCell: pal.grid } }
      }
      const j = col - 1
      const spare = j >= t.concs.length
      const mk = (v: number | null | undefined, opts: { readonly?: boolean; display?: string; theme?: Partial<Theme> } = {}): GridCell => ({
        kind: GridCellKind.Number,
        data: v ?? undefined,
        displayData: opts.display ?? (v === null || v === undefined ? '' : String(v)),
        allowOverlay: !opts.readonly,
        readonly: !!opts.readonly,
        contentAlign: 'right',
        themeOverride: opts.theme,
      })
      if (row === 0) {
        if (spare) return mk(null, { display: '+ c', theme: { bgCell: pal.grid, textDark: pal.muted } })
        return mk(j === 0 ? 0 : t.concs[j], { readonly: j === 0, theme: { bgCell: pal.grid, textDark: pal.fg, baseFontStyle: '600 12px' } })
      }
      if (row <= R) return mk(spare ? null : (t.cells[j]?.[row - 1] ?? null))
      // computed rows
      const st = spare ? null : stats[j]
      const isMean = row === R + 1
      if (st) {
        const v = isMean ? st.mean : st.sd
        return mk(v, { readonly: true, display: v === null ? '–' : fmt(v, 4), theme: { textDark: pal.muted, bgCell: pal.grid } })
      }
      const typed = spare ? null : t.typed[j]
      const v = typed ? (isMean ? typed.mean : typed.sd) : null
      return mk(v, { readonly: spare, theme: spare ? { bgCell: pal.grid } : undefined })
    },
    [pal, stats],
  )

  const onCellEdited = useCallback(
    ([col, row]: Item, v: GridCell) => {
      if (v.kind !== GridCellKind.Number) return
      const { table: t, reps: R } = live.current
      const ref = refOf(col, row, R)
      if (!ref) return
      commit(setTableCell(t, ref, v.data === undefined || Number.isNaN(v.data) ? null : v.data))
    },
    [commit],
  )

  const onPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]) => {
      const { table: t, reps: R } = live.current
      const whole = pasteWhole(values.map((r) => r.join('\t')).join('\n'))
      if (whole) {
        commit(whole)
        return false
      }
      let next = t
      values.forEach((line, dr) =>
        line.forEach((txt, dc) => {
          const ref = refOf(target[0] + dc, target[1] + dr, R)
          if (!ref) return
          next = setTableCell(next, ref, parseNum(txt))
        }),
      )
      commit(next)
      return false
    },
    [commit],
  )

  // Size the grid to its content so there is no empty canvas to the right or below.
  const contentW = LABEL_W + cols * COL_W + 2
  const [boxW, setBoxW] = useState(0)
  useEffect(() => {
    const el = wrap.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scrollbar = boxW > 0 && contentW > boxW ? 12 : 0 // room for the horizontal scrollbar only when needed
  const height = Math.min(rows * ROW_H + 2 + scrollbar, 360)
  return (
    <div
      ref={wrap}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={() =>
        // keep the panel wide while focus moves into Glide's overlay editor (rendered in #portal)
        setTimeout(() => {
          const a = document.activeElement
          const portal = document.getElementById('portal')
          if (!a || (!wrap.current?.contains(a) && !portal?.contains(a))) onFocusChange(false)
        }, 0)
      }
      onKeyDown={(e) => {
        if (e.key === 'Escape')
          setTimeout(() => {
            const portal = document.getElementById('portal')
            if (!portal || !portal.firstElementChild) (document.activeElement as HTMLElement | null)?.blur()
          }, 0)
      }}
      style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', width: contentW, maxWidth: '100%' }}
    >
      <DataEditor
        columns={columns}
        rows={rows}
        getCellContent={getCellContent}
        onCellEdited={onCellEdited}
        onPaste={onPaste}
        onDelete={() => true}
        getCellsForSelection={true}
        headerHeight={0}
        rowHeight={ROW_H}
        rowMarkers="none"
        smoothScrollX
        smoothScrollY
        width="100%"
        height={height}
        theme={theme}
        rangeSelect="rect"
        freezeColumns={1}
        verticalBorder={true}
        overscrollX={0}
        overscrollY={0}
        scaleToRem={false}
      />
    </div>
  )
}

/** One-line entry: `0:48,52,47  1:55±2.5  5:96` — Enter merges into the table (one undo step). */
export function QuickEntry({ table, onApply }: { table: TableData; onApply: (t: TableData, n: number) => void }) {
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const apply = () => {
    if (!text.trim()) return
    const items = parseQuick(text)
    if (!items) return setBad(true)
    onApply(mergeQuick(table, items), items.length)
    setText('')
    setBad(false)
  }
  return (
    <input
      type="text"
      className="bare mono w-full text-[11.5px]"
      style={bad ? { color: 'var(--bad)' } : undefined}
      placeholder="quick add: 0:48,52,47  1:55±2.5  5:96 ⏎"
      title="c:readings,comma,separated  ·  c:mean±sd  ·  c:mean — Enter adds (or replaces) those columns"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        setBad(false)
      }}
      onKeyDown={(e) => e.key === 'Enter' && apply()}
    />
  )
}
