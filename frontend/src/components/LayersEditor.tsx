import { useMemo } from 'react'
import { cumulative } from '../math/layers'
import type { Layer } from '../math/types'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { IconX, NumField } from './ui'

/** One colour per layer (index), shared by the editor and the budget bars. */
export const LAYER_COLORS = ['#7c6fd6', '#d68a3c', '#3c9d8a', '#c75b8a', '#6a9a3c', '#4a8fd0']
export const layerColor = (i: number) => LAYER_COLORS[i % LAYER_COLORS.length]

const QUICK: { name: string; layer: Partial<Layer> }[] = [
  { name: 'Lot', layer: { units: 3, cv: 0.03, gainCv: 0.05 } },
  { name: 'Reader', layer: { units: 4, offsetSd: 0, cv: 0.02, noiseCv: 0.1 } },
  { name: 'Day', layer: { units: 3, cv: 0.02 } },
  { name: 'Operator', layer: { units: 2, cv: 0.01 } },
]

const pctField = (v: number) => +(v * 100).toPrecision(3)

/**
 * Predict (spec §22): the sources of variability on top of the within-run curve. Each row: on/off, name, units, and
 * four sizes. The summary line shows what they cost in resolvable levels.
 */
export function LayersEditor({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const { series } = d
  const layers = series.layers ?? []
  const cum = useMemo(() => (layers.length ? cumulative(series) : null), [series, layers.length])
  // always start from the current layers (several quick edits in a row must not overwrite each other)
  const current = () => {
    const st = useStore.getState()
    return st.series.find((x) => x.id === st.activeId)?.layers ?? []
  }
  const set = (i: number, p: Partial<Layer>) => patch({ layers: current().map((l, j) => (j === i ? { ...l, ...p } : l)) })
  const add = (q: (typeof QUICK)[number]) =>
    patch({ layers: [...current(), { name: q.name, units: 3, on: true, offsetSd: 0, cv: 0, gainCv: 0, noiseCv: 0, ...q.layer }] })
  const onCount = layers.filter((l) => l.on).length
  const allOn = cum ? cum[cum.length - 1].n : null

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-baseline justify-between">
        <span className="label">Variability layers</span>
        {cum && (
          <span className="text-[11px] text-muted" title="resolvable levels within one run → with every layer">
            <b className="text-fg">{cum[0].n}</b> within a run → <b className="text-fg">{allOn}</b> with all
          </span>
        )}
      </div>
      {!layers.length && (
        <p className="text-[11.5px] leading-snug text-muted">
          The curve above is one run. Add the sources that vary between runs, to predict what they cost:
        </p>
      )}
      {layers.map((l, i) => (
        <div key={i} className="rounded-md border border-line px-2 py-1.5" style={{ boxShadow: `inset 3px 0 0 ${layerColor(i)}`, opacity: l.on ? 1 : 0.55 }}>
          <div className="flex items-center gap-1.5">
            <input type="checkbox" checked={l.on} onChange={(e) => set(i, { on: e.target.checked })} title="Count this layer (aggregate) or leave it out (disaggregate)" />
            <input type="text" className="bare w-[84px] font-medium" value={l.name} onChange={(e) => set(i, { name: e.target.value })} />
            <span className="text-[11px] text-muted">×</span>
            <NumField value={l.units} min={1} max={50} step={1} width={34} onCommit={(units) => set(i, { units: Math.round(units) })} title="units an experiment uses (e.g. 4 readers)" />
            <span className="flex-1" />
            <button className="btn ghost text-faint" style={{ height: 18, padding: '0 3px' }} onClick={() => patch({ layers: current().filter((_, j) => j !== i) })} title="Remove layer">
              <IconX />
            </button>
          </div>
          <div className="mt-1 grid grid-cols-4 gap-1 text-[10.5px] text-muted">
            {(
              [
                ['offset', 'offsetSd', 'reads a fixed amount high/low (signal units, SD between units)', false],
                ['CV %', 'cv', 'reads x % high/low everywhere (SD between units)', true],
                ['gain %', 'gainCv', 'steeper / flatter curve: performance differences between units', true],
                ['noise %', 'noiseCv', 'some units noisier than others', true],
              ] as const
            ).map(([label, key, tip, pct]) => (
              <label key={key} className="flex flex-col" title={tip}>
                {label}
                <NumField
                  value={pct ? pctField(l[key]) : +l[key].toPrecision(4)}
                  min={0}
                  step={pct ? 0.5 : 1}
                  width={56}
                  onCommit={(v) => set(i, { [key]: pct ? v / 100 : v } as Partial<Layer>)}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-faint">add</span>
        {QUICK.filter((q) => !layers.some((l) => l.name === q.name)).map((q) => (
          <button key={q.name} className="btn" style={{ height: 22, fontSize: 11 }} onClick={() => add(q)}>
            + {q.name}
          </button>
        ))}
        <button className="btn" style={{ height: 22, fontSize: 11 }} onClick={() => add({ name: `Layer ${layers.length + 1}`, layer: {} })}>
          + other
        </button>
      </div>
      {layers.length > 0 && onCount === 0 && <p className="text-[11px] text-muted">All layers off: the app shows within-run variability only.</p>}
    </div>
  )
}
