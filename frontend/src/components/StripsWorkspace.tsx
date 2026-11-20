/**
 * Strips workspace (spec §21): the place kept for the strip simulator, which is a separate program. Nothing is
 * drawn here yet; `stripSpec` is the hand-over, so the simulator can be mounted without touching the rest.
 */
import { fmt, withUnits } from '../format'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { Page, Verdict } from './kit'

export interface StripSpec {
  analyte: string
  units: string
  signalLabel: string
  /** one entry per level: what a strip at that concentration should show */
  levels: { c: number; mean: number; sd: number }[]
  /** signal of a blank and at the top of the range, for scaling line intensity */
  blank: number
  top: number
}

/** What a strip renderer needs from the current series. */
export function stripSpec(d: Derived): StripSpec {
  const { series: s, model: m } = d
  return {
    analyte: s.analyte,
    units: s.units,
    signalLabel: s.signalLabel,
    levels: m.levels.map((c) => ({ c, mean: m.mean(c), sd: m.sd(c) })),
    blank: m.mean(0),
    top: m.mean(m.cMax),
  }
}

export function StripsWorkspace({ d }: { d: Derived }) {
  const notify = useStore((s) => s.notify)
  const spec = stripSpec(d)
  return (
    <Page width={820}>
      <Verdict sub="This space is kept for the strip simulator. It will draw what the test line looks like at each level, with realistic strip-to-strip variation, from the numbers below.">
        Simulated strips will appear here.
      </Verdict>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(8, Math.max(1, spec.levels.length))}, minmax(0, 1fr))` }}>
        {spec.levels.slice(0, 8).map((l) => {
          const t = Math.min(1, Math.max(0, (l.mean - spec.blank) / (spec.top - spec.blank || 1)))
          return (
            <div key={l.c} className="flex flex-col items-center gap-1.5">
              <div className="strip-slot" title={`mean ${fmt(l.mean, 4)} · SD ${fmt(l.sd)}`}>
                <span style={{ top: '34%', opacity: 0.55 }} />
                <span style={{ top: '58%', opacity: 0.08 + 0.8 * t }} />
              </div>
              <span className="text-[11.5px]">{withUnits(l.c, spec.units)}</span>
            </div>
          )
        })}
      </div>
      <p className="m-0 text-[12px] text-muted">
        The placeholders above only scale the test line with the mean signal.{' '}
        <button
          className="link"
          onClick={() => navigator.clipboard?.writeText(JSON.stringify(spec, null, 2)).then(() => notify('Strip hand-over copied as JSON', false))}
          title="The numbers a strip renderer receives: levels with mean and SD, blank and top signal, labels"
        >
          Copy the hand-over JSON
        </button>
      </p>
    </Page>
  )
}
