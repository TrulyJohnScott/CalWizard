import { ladder } from '../math/analysis'
import { fmt } from '../format'
import { METRIC_LABEL } from '../math/metrics'
import type { Derived } from './derived'
import { useStore } from './store'

/**
 * Auto-space (spec §11 v2.6): anchors one target unit apart (the §12 ladder, sig 4) from the selected anchor, else 0,
 * up to cMax; anchors below the start are kept; levels are not changed. The toast's Undo restores the previous anchors.
 */
export function autoSpace(d: Derived): void {
  const st = useStore.getState()
  const m = d.model
  const s = d.series
  const measure = st.measure
  const sel = measure?.sel
  const start = measure && sel !== null && sel !== undefined ? measure.pts[sel] : 0
  const steps = ladder({ mean: m.mean, sd: m.sd, cMax: m.cMax }, s.metric, s.kTarget, 4, 200, start)
  const keep = (measure?.pts ?? []).filter((p) => p < start)
  const before = measure
  st.setMeasurePts([...keep, ...steps.filter((c) => c > 0)])
  st.notify(`Placed ${steps.length - 1} anchors one ${METRIC_LABEL[s.metric]} target apart from ${fmt(start)}`, () => useStore.setState({ measure: before }))
}
