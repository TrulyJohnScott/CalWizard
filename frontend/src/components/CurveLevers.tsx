/**
 * Left column, under the curve definition (core design): the four levers on the curve (spec §14), always visible.
 * Each change shows as was → now; Reset goes back to the measured curve, Keep folds the change in.
 */
import { fmt } from '../format'
import type { Adjust } from '../math/types'
import { bake, withAdjust } from '../math/whatif'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { Scrub } from './kit'

export function CurveLevers({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const notify = useStore((s) => s.notify)
  const handlesOn = useStore((s) => s.ui.whatIf)
  const setUi = useStore((s) => s.setUi)
  const { series: s, model: m, baseline: base } = d
  const a = m.adjust
  const b0 = a ? a.b0 : m.mean(0)
  const t0 = a ? a.t0 : m.mean(m.cMax)
  const span = Math.abs(t0 - b0) || Math.abs(t0) || 1
  const set = (p: Partial<Adjust>) => patch({ adjust: withAdjust(s.adjust, p) })
  const lod = d.limits?.lod?.c ?? null
  const lod0 = base?.limits?.lod?.c ?? null
  return (
    <section className="mt-5 flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <span className="label">Adjust</span>
        <label className="flex items-center gap-1.5 text-[11px] text-muted" title="Show drag handles for these on the curve">
          <input type="checkbox" checked={handlesOn} onChange={(e) => setUi({ whatIf: e.target.checked })} />
          handles on the curve
        </label>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Scrub label="background" value={s.adjust?.bottom ?? b0} step={span / 400} width={58} onChange={(v) => set({ bottom: v === b0 ? null : v })} title="Signal of a blank: lower it to model less non-specific binding" />
        <Scrub label="top" value={s.adjust?.top ?? t0} step={span / 200} width={58} onChange={(v) => set({ top: v === t0 ? null : v })} title="Signal at the top of the range: raise it to model a stronger test line" />
        <Scrub label="midpoint ×" value={s.adjust?.cScale ?? 1} step={0.005} min={0.05} max={20} width={46} digits={3} onChange={(v) => set({ cScale: v })} title="Below 1 the curve responds at lower concentrations (0.5 = twice the affinity)" />
        <Scrub label="noise ×" value={s.adjust?.sdScale ?? 1} step={0.005} min={0} max={10} width={46} digits={3} onChange={(v) => set({ sdScale: v })} title="Every SD is multiplied by this: 0.7 means CVs 30% tighter" />
      </div>
      {base ? (
        <>
          <div className="text-[11.5px] text-muted">
            points apart {base.resolvable} → <b className="text-fg">{d.resolvable.length}</b> · LoD {fmt(lod0)} → <b className="text-fg">{fmt(lod)}</b>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => patch({ adjust: null })} title="Back to the curve as measured">
              Reset
            </button>
            <button
              className="btn"
              title="Fold the change into the data or functions, so it becomes the curve"
              onClick={() => {
                const b = bake(s)
                patch({ adjust: null, meanExpr: b.meanExpr, sdExpr: b.sdExpr, replicates: b.replicates, summary: b.summary, extraLevels: b.extraLevels })
                notify('The adjusted curve is now the curve')
              }}
            >
              Keep
            </button>
          </div>
        </>
      ) : (
        <div className="text-[11px] text-muted">Drag a label or type: the curve, points and limits follow. The measured curve stays as a dashed line.</div>
      )}
    </section>
  )
}
