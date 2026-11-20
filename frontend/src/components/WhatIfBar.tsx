/**
 * What-if bar (spec §14, §21): four levers on the curve that match bench work (background, top, midpoint, noise),
 * and what they do to the headline claims. A layer on top of the data: Reset removes it, Keep folds it in.
 */
import { fmt, withUnits } from '../format'
import { bake, withAdjust } from '../math/whatif'
import type { Adjust } from '../math/types'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { Scrub } from './kit'

function Delta({ label, from, to, better }: { label: string; from: string; to: string; better: boolean | null }) {
  if (from === to) return null
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted">{label} </span>
      {from} → <b style={{ color: better === null ? undefined : better ? 'var(--good)' : 'var(--bad)' }}>{to}</b>
    </span>
  )
}

export function WhatIfBar({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const notify = useStore((s) => s.notify)
  const setUi = useStore((s) => s.setUi)
  const { series: s, model: m, baseline: base } = d
  const a = m.adjust
  const b0 = a ? a.b0 : m.mean(0)
  const t0 = a ? a.t0 : m.mean(m.cMax)
  const span = Math.abs(t0 - b0) || Math.abs(t0) || 1
  const set = (p: Partial<Adjust>) => patch({ adjust: withAdjust(s.adjust, p) })
  const u = s.units
  const lod = d.limits?.lod?.c ?? null
  const lod0 = base?.limits?.lod?.c ?? null
  const loq = d.limits?.loq?.c ?? null
  const loq0 = base?.limits?.loq?.c ?? null
  const cmp = (now: number | null, was: number | null, lowerIsBetter: boolean) => (now === null || was === null ? null : lowerIsBetter ? now < was : now > was)
  return (
    <div className="whatif flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line px-3 py-1.5">
      <span className="text-[12px] font-semibold text-accent">What if</span>
      <Scrub label="background" value={s.adjust?.bottom ?? b0} step={span / 400} width={62} onChange={(v) => set({ bottom: v === b0 ? null : v })} title="Signal of a blank: lower it to model less non-specific binding. Drag the label, type, or use the arrow keys." />
      <Scrub label="top" value={s.adjust?.top ?? t0} step={span / 200} width={62} onChange={(v) => set({ top: v === t0 ? null : v })} title="Signal at the top of the range: raise it to model a stronger test line" />
      <Scrub label="midpoint ×" value={s.adjust?.cScale ?? 1} step={0.005} min={0.05} max={20} width={50} digits={3} onChange={(v) => set({ cScale: v })} title="Stretch of the concentration axis: below 1 the curve responds at lower concentrations" />
      <Scrub label="noise ×" value={s.adjust?.sdScale ?? 1} step={0.005} min={0} max={10} width={50} digits={3} onChange={(v) => set({ sdScale: v })} title="Every SD is multiplied by this: 0.7 means CVs 30% tighter" />
      {base ? (
        <span className="flex flex-wrap items-center gap-x-4 text-[12px]">
          <Delta label="levels" from={String(base.resolvable)} to={String(d.resolvable.length)} better={d.resolvable.length === base.resolvable ? null : d.resolvable.length > base.resolvable} />
          <Delta label="LoD" from={fmt(lod0)} to={withUnits(lod, u)} better={cmp(lod, lod0, true)} />
          <Delta label="LoQ" from={fmt(loq0)} to={withUnits(loq, u)} better={cmp(loq, loq0, true)} />
        </span>
      ) : (
        <span className="label">Change a lever, or drag the diamonds on the curve. The dashed line keeps today’s curve in view.</span>
      )}
      <span className="flex-1" />
      {base && (
        <>
          <button className="btn" onClick={() => patch({ adjust: null })} title="Back to the curve as measured">
            Reset
          </button>
          <button
            className="btn"
            title="Fold the change into the equations / table, so it becomes the curve"
            onClick={() => {
              const b = bake(s)
              patch({ adjust: null, meanExpr: b.meanExpr, sdExpr: b.sdExpr, replicates: b.replicates, summary: b.summary, extraLevels: b.extraLevels })
              notify('The what-if is now the curve')
            }}
          >
            Keep as the curve
          </button>
        </>
      )}
      <button className="btn ghost" onClick={() => setUi({ whatIf: false })} title="Hide the levers (an active what-if stays applied)">
        Hide
      </button>
    </div>
  )
}
