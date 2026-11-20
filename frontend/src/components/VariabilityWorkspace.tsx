/**
 * Variability workspace (spec §22, §21): the curve is one run on one lot and one reader. Here the sources that vary
 * between runs are layered on top: predict what each costs, plan an experiment across them, dial in measured sizes.
 */
import { useMemo } from 'react'
import { cumulative } from '../math/layers'
import type { Derived } from '../state/derived'
import { BudgetPanel } from './BudgetPanel'
import { DesignBlock } from './ExperimentPanel'
import { layerColor, LayersEditor } from './LayersEditor'
import { Page, Section, Verdict } from './kit'

/** Resolvable levels as each layer is added: one bar per step, so the costly layer is the visible drop. */
function Chain({ steps }: { steps: { layers: string[]; n: number }[] }) {
  const top = Math.max(1, ...steps.map((s) => s.n))
  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((s, i) => {
        const lost = i > 0 ? steps[i - 1].n - s.n : 0
        return (
          <div key={i} className="grid items-center gap-3 text-[12.5px]" style={{ gridTemplateColumns: '120px minmax(0, 1fr) 90px' }}>
            <span className="truncate text-muted">{i === 0 ? 'one run' : `+ ${s.layers[s.layers.length - 1]}`}</span>
            <div className="h-[14px] rounded-sm" style={{ background: 'var(--hover)' }}>
              <div className="h-full rounded-sm" style={{ width: `${(100 * s.n) / top}%`, background: i === 0 ? 'var(--muted)' : layerColor(i - 1), opacity: i === 0 ? 0.5 : 0.9, transition: 'width 180ms ease-out' }} />
            </div>
            <span>
              <b>{s.n}</b> <span className="text-muted">levels</span>
              {lost > 0 && <span style={{ color: 'var(--bad)' }}> −{lost}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function VariabilityWorkspace({ d }: { d: Derived }) {
  const { series: s } = d
  const layers = s.layers ?? []
  const on = layers.filter((l) => l.on)
  const steps = useMemo(() => (layers.length ? cumulative(s) : []), [s, layers.length])
  const n0 = steps[0]?.n ?? d.resolvable.length
  const nAll = d.resolvable.length
  return (
    <Page width={1080}>
      <Verdict
        ok={layers.length ? nAll >= n0 : undefined}
        sub="The curve is one run on one lot and one reader. Layers are what changes between runs: each has an offset, a proportional CV, a gain CV (steeper or flatter curves) and a noise CV. With a layer on, every other workspace uses the combined spread."
      >
        {!layers.length
          ? 'What do lots, readers and days cost?'
          : !on.length
            ? `All layers are off: ${n0} levels, as within one run.`
            : nAll === n0
              ? `Across ${on.map((l) => l.name.toLowerCase()).join(', ')}, all ${n0} levels of a single run survive.`
              : `Across ${on.map((l) => l.name.toLowerCase()).join(', ')}, ${nAll} of the ${n0} levels of a single run survive.`}
      </Verdict>

      {steps.length > 1 && <Chain steps={steps} />}

      <div className="grid gap-x-10 gap-y-6" style={{ gridTemplateColumns: 'minmax(300px, 4fr) minmax(0, 5fr)' }}>
        <div className="flex flex-col gap-4">
          <Section title="1 · Predict" hint="What you expect each source to add">
            <div className="vw-embed">
              <LayersEditor d={d} />
            </div>
          </Section>
          {layers.length > 0 && (
            <Section title="2 · Plan" hint="An experiment spread over those units: what would it show, and how well would it size each source?">
              <div className="vw-embed">
                <DesignBlock d={d} />
              </div>
            </Section>
          )}
        </div>
        <Section title={layers.length ? '3 · Budget and dial-in' : 'Budget'} hint="Where the spread comes from at each level; paste real results to replace the predictions">
          <div className="vw-embed">
            <BudgetPanel d={d} />
          </div>
        </Section>
      </div>
    </Page>
  )
}
