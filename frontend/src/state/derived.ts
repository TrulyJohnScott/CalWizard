import { useMemo } from 'react'
import { ladder } from '../math/analysis'
import { measuredN, simulate, type Experiment } from '../math/experiment'
import { limits as computeLimits, limitsData as computeLimitsData, type Limits, type LimitsData } from '../math/limits'
import { compileModel, type Model } from '../math/model'
import { checkRequirements, type RequirementCheck } from '../math/requirements'
import { signalRange } from '../charts/common'
import { levelDots, type LevelDots } from '../math/sim'
import type { Series } from '../math/types'
import { useActive, useStore } from './store'

/** The same headline numbers for the curve without the what-if layer (only while a layer is active). */
export interface Baseline {
  model: Model
  resolvable: number
  limits: Limits | null
}

export interface Derived {
  series: Series
  model: Model
  /** concentrations shown in the Levels sidebar (ladder list in table modes, else the model levels) */
  listed: number[]
  dots: LevelDots[]
  /** shared signal range of both charts (fitted to the focus window when zoomed) */
  range: [number, number]
  /** zoomed concentration window, or null */
  focus: [number, number] | null
  /** the headline ladder from 0 to cMax (sig 4, series metric/k); its length is "N resolvable levels" */
  resolvable: number[]
  /** simulated experiment (spec §13) when the Experiment view is open, else null; or an error message */
  exp: Experiment | null
  expError: string | null
  /** LoB / LoD / LoQ and the precision profile (spec §15); null when the curve is invalid */
  limits: Limits | null
  /** classical estimate from the entered replicates, when the table has a blank and low columns */
  limitsData: LimitsData | null
  requirements: RequirementCheck
  baseline: Baseline | null
}

const safe = <T,>(fn: () => T): T | null => {
  try {
    return fn()
  } catch {
    return null
  }
}

/** Active series -> compiled model, dots and the sidebar list. Recomputed only when inputs change. */
export function useDerived(): Derived {
  const series = useActive()
  const lad = useStore((s) => s.ladder)
  const model = useMemo(() => compileModel(series), [series])
  const dots = useMemo(() => levelDots(series, model), [series, model])
  const focus = useStore((s) => s.focus)
  const hold = useStore((s) => s.hold)
  const fitted = useMemo(() => signalRange(model, dots, focus), [model, dots, focus])
  const range = hold ?? fitted
  const listed = lad?.list ?? model.levels
  // independent of the levels list, so dragging/editing levels does not recompute it
  const { mode, meanExpr, sdExpr, cMax, replicates, summary, metric, kTarget, adjust } = series
  const resolvable = useMemo(
    () => ladder(model, metric, kTarget, 4),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, meanExpr, sdExpr, cMax, replicates, summary, metric, kTarget, adjust],
  )
  const lim = series.limits
  const limits = useMemo(
    () => safe(() => computeLimits(model, lim)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, meanExpr, sdExpr, cMax, replicates, summary, adjust, lim],
  )
  const limitsData = useMemo(
    () => safe(() => computeLimitsData(series, model, lim.alpha, lim.beta)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, replicates, summary, adjust, lim],
  )
  const requirements = useMemo(
    () => safe(() => checkRequirements(series, model)) ?? { results: [], met: 0, total: 0 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, meanExpr, sdExpr, cMax, replicates, summary, metric, kTarget, adjust, lim, series.requirements],
  )
  const baseline = useMemo<Baseline | null>(() => {
    if (!model.adjusted) return null
    const bm = compileModel({ ...series, adjust: null })
    return { model: bm, resolvable: ladder(bm, metric, kTarget, 4).length, limits: safe(() => computeLimits(bm, { ...lim, profile: false })) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.adjusted, mode, meanExpr, sdExpr, cMax, replicates, summary, metric, kTarget, lim])
  const es = useStore((s) => s.exp)
  const { exp, expError } = useMemo(() => {
    if (!es.open) return { exp: null, expError: null }
    try {
      let concs = listed
      let n: number | number[] = es.n
      if (es.asMeasured && series.mode === 'replicates') {
        const counts = measuredN(series.replicates.cells)
        const cols = series.replicates.concs.map((c, j) => ({ c, k: counts[j] ?? 0 })).filter((x) => x.c !== null && x.k >= 2)
        concs = cols.map((x) => x.c as number)
        n = cols.map((x) => x.k)
      }
      return { exp: simulate(model, { concs, n, runs: es.runs, seed: es.seed, metric: series.metric, k: series.kTarget }), expError: null }
    } catch (e) {
      return { exp: null, expError: e instanceof Error ? e.message : String(e) }
    }
  }, [es, listed, model, series.mode, series.replicates, series.metric, series.kTarget])
  // while experimenting, the scatter shows this run's readings instead of the simulated / entered dots
  const shownDots = exp ? exp.first.levels.map((l) => ({ c: l.c, ys: l.ys })) : dots
  return { series, model, dots: shownDots, listed, range, focus, resolvable, exp, expError, limits, limitsData, requirements, baseline }
}
