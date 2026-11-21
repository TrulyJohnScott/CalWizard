/**
 * Fill (core design): place round concentrations (1-2-5 series) from 0 up to the top of the usable range, keeping
 * each only when it is apart from the previous one under the current rule. Never fractional ladder values.
 */
import { withUnits } from '../format'
import { cTop } from '../math/hook'
import type { Derived } from './derived'
import { fill125 } from './points'
import { useStore } from './store'

export function autoSpace(d: Derived): void {
  const st = useStore.getState()
  const before = st.measure
  const pts = fill125(d.series, d.model, cTop(d.model))
  st.setMeasurePts(pts)
  st.notify(
    pts.length ? `Placed ${pts.length} round concentrations, each apart from the one below (up to ${withUnits(pts[pts.length - 1], d.series.units)})` : 'No round concentration is apart from 0 under this rule',
    () => useStore.setState({ measure: before }),
  )
}
