import { fmt } from '../format'
import { closenessColor, closenessQ, rgbaCss } from '../math/closeness'
import { METRIC_LABEL } from '../math/metrics'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { NumField, Seg } from './ui'

const pct = (p: number) => `${Math.round(100 * p)}%`

/** Spec §13: what one experiment (and many) would show, against the truth on the left. */
export function ExperimentPanel({ d }: { d: Derived }) {
  const es = useStore((s) => s.exp)
  const setExp = useStore((s) => s.setExp)
  const { series: s, exp } = d
  const metric = METRIC_LABEL[s.metric]
  const isTable = s.mode === 'replicates'

  return (
    <div className="flex flex-col gap-2 px-3 pt-2 pb-3 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted" title="readings per concentration in one experiment">
          n per level
        </span>
        {isTable && es.asMeasured ? (
          <span className="text-muted">as measured</span>
        ) : (
          <NumField value={es.n} min={2} max={1000} step={1} width={48} onCommit={(n) => setExp({ n: Math.round(n) })} />
        )}
      </div>
      {isTable && (
        <div className="flex items-center justify-between gap-2" title="n per column = readings actually in your table: what ranges could your data have produced?">
          <span className="text-muted">use your table's n</span>
          <Seg value={es.asMeasured ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => setExp({ asMeasured: v === 'on' })} />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted" title="how many experiments to summarise">
          runs
        </span>
        <Seg<string>
          value={String(es.runs)}
          options={[
            ['1', '1'],
            ['200', '200'],
            ['1000', '1000'],
          ]}
          onChange={(v) => setExp({ runs: Number(v) })}
        />
      </div>
      <div className="flex items-center gap-2">
        <button className="btn" onClick={() => setExp({ seed: es.seed + 1 })} title="Draw a new experiment">
          Re-roll
        </button>
        <span className="text-[11px] text-faint">seed {es.seed}</span>
      </div>

      {d.expError && <div className="text-bad">{d.expError}</div>}
      {exp && (
        <>
          <div className="border-t border-line pt-2 leading-snug">
            <div>
              <span className="text-muted">resolved pairs · truth </span>
              <b>{exp.truth.resolvedPairs}</b>
              <span className="text-muted"> · this run </span>
              <b>{exp.first.resolvedPairs}</b>
              <span className="text-muted"> of {exp.truth.rows.length}</span>
            </div>
            {exp.runs > 1 && (
              <div className="text-muted">
                {Math.round(100 * exp.conf)}% of runs: {fmt(exp.resolvedPairs.lo ?? 0, 2)}–{fmt(exp.resolvedPairs.hi ?? 0, 2)} · all pass {pct(exp.pAllPass)}
              </div>
            )}
          </div>

          <div className="grid items-center text-[11px] text-muted" style={{ gridTemplateColumns: '64px 1fr 40px' }}>
            <span>pair</span>
            <span title={`${metric}: truth tick, this run dot, ${Math.round(100 * exp.conf)}% of runs bar`}>{metric}</span>
            <span className="text-right" title="share of runs in which the pair is resolved">
              P(pass)
            </span>
          </div>
          {(() => {
            // one shared scale for all bars: 0 … max of everything shown (metric values can be negative for Z′)
            const vals = exp.pairs.flatMap((p) => [p.truth, p.lo ?? NaN, p.hi ?? NaN]).concat(exp.first.rows.map((r) => r.value), [exp.k])
            const fin = vals.filter(Number.isFinite)
            const lo = Math.min(0, ...fin)
            const hi = Math.max(...fin, 1e-9)
            const X = (v: number) => `${(100 * (Math.min(hi, Math.max(lo, v)) - lo)) / (hi - lo)}%`
            return exp.pairs.map((p, i) => {
              const run = exp.first.rows[i]
              const col = closenessColor(closenessQ({ dsum: run.dsum, ssmd: run.ssmd, zprime: run.zprime }, s.metric, s.kTarget))
              const solid = rgbaCss([col[0], col[1], col[2], 1])
              return (
                <div key={i} className="grid items-center border-t border-line" style={{ gridTemplateColumns: '64px 1fr 40px', height: 26 }}>
                  <span className="truncate" title={`${fmt(p.c1)} → ${fmt(p.c2)}`}>
                    {fmt(p.c1, 3)}→{fmt(p.c2, 3)}
                  </span>
                  <div
                    className="relative h-[14px]"
                    title={`truth ${fmt(p.truth)} · this run ${fmt(run.value)}${exp.runs > 1 ? ` · ${Math.round(100 * exp.conf)}% of runs ${fmt(p.lo ?? NaN)}–${fmt(p.hi ?? NaN)}` : ''}`}
                  >
                    <div className="absolute inset-y-[6px] left-0 right-0 bg-line" />
                    {/* target k */}
                    <div className="absolute top-0 bottom-0 w-px bg-muted opacity-60" style={{ left: X(exp.k) }} />
                    {exp.runs > 1 && p.lo !== null && p.hi !== null && (
                      <div className="absolute inset-y-[4px] rounded-sm" style={{ left: X(p.lo), width: `calc(${X(p.hi)} - ${X(p.lo)})`, background: rgbaCss(col, 0.9) }} />
                    )}
                    {/* truth tick */}
                    <div className="absolute top-0 bottom-0 w-[2px] bg-fg" style={{ left: X(p.truth) }} />
                    {/* this run */}
                    {Number.isFinite(run.value) && (
                      <div className="absolute top-[3px] h-[8px] w-[8px] -translate-x-1/2 rounded-full border border-bg" style={{ left: X(run.value), background: solid }} />
                    )}
                  </div>
                  <span className="text-right">{exp.runs > 1 ? pct(p.pPass) : run.pass ? '✓' : '✗'}</span>
                </div>
              )
            })
          })()}
          <div className="text-[11px] text-faint">bar: {Math.round(100 * exp.conf)}% of runs · line: truth · dot: this run · thin mark: target</div>
        </>
      )}
    </div>
  )
}
