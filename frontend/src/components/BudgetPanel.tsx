import { useMemo, useState } from 'react'
import { dialIn, type DialInResult } from '../api'
import { fmt } from '../format'
import { budget, cumulative } from '../math/layers'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { layerColor } from './LayersEditor'

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(100 * v)}%`)

/**
 * Budget (spec §16): where the variability comes from at each level, what each layer costs in resolvable levels, and
 * dial-in: paste real results, see measured vs predicted sizes, adopt them.
 */
export function BudgetPanel({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const notify = useStore((s) => s.notify)
  const { series: s, model: m } = d
  const layers = s.layers ?? []
  const rows = useMemo(() => budget(s, m, d.listed), [s, m, d.listed])
  const cum = useMemo(() => cumulative(s), [s])
  const [csv, setCsv] = useState('')
  const [res, setRes] = useState<DialInResult | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (!layers.length)
    return (
      <div className="px-3 pt-3 text-[12px] leading-snug text-muted">
        No variability layers yet. Add lots, readers or days under <b className="text-fg">Variability layers</b> on the left to see where the spread
        comes from and what it costs.
      </div>
    )

  const estimate = async () => {
    setBusy(true)
    setErr('')
    try {
      setRes(await dialIn(s, csv))
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    }
    setBusy(false)
  }
  const adopt = () => {
    if (!res) return
    patch({
      layers: layers.map((l) => {
        const r = res.layers.find((x) => x.name === l.name)
        return r ? { ...l, offsetSd: +r.measured.offsetSd.toPrecision(3), cv: +r.measured.cv.toPrecision(3), gainCv: +r.measured.gainCv.toPrecision(3) } : l
      }),
    })
    notify('Layers now use the measured sizes')
  }

  return (
    <div className="flex flex-col gap-3 px-3 pt-2 pb-3 text-[12px]">
      {/* the story: resolvable levels as layers are added */}
      <div>
        <div className="label mb-1">resolvable levels</div>
        <div className="flex flex-wrap items-center gap-1 text-[11.5px]">
          {cum.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-faint">→</span>}
              <span className="rounded px-1" style={i > 0 ? { boxShadow: `inset 0 -2px 0 ${layerColor(i - 1)}` } : undefined}>
                <span className="text-muted">{i === 0 ? 'one run' : `+ ${c.layers[c.layers.length - 1]}`}</span> <b>{c.n}</b>
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* stacked shares per level */}
      <div>
        <div className="label mb-1">where the spread comes from</div>
        {rows.map((r) => (
          <div key={r.c} className="mb-1 grid items-center gap-2" style={{ gridTemplateColumns: '44px 1fr 46px' }}>
            <span className="text-[11px] text-muted">{fmt(r.c, 3)}</span>
            <div className="flex h-[10px] overflow-hidden rounded-sm bg-line" title={`total SD ${fmt(Math.sqrt(r.total))} · within-run ${pct(r.withinShare)}`}>
              <div style={{ width: `${100 * (r.withinShare ?? 0)}%`, background: 'var(--muted)', opacity: 0.45 }} />
              {r.layers.map((l, i) => (l.share ? <div key={i} style={{ width: `${100 * l.share}%`, background: layerColor(i) }} title={`${l.name} ${pct(l.share)}`} /> : null))}
            </div>
            <span className="text-right text-[11px] text-muted">SD {fmt(Math.sqrt(r.total), 3)}</span>
          </div>
        ))}
        <div className="mt-1 flex flex-wrap gap-x-2 text-[10.5px] text-muted">
          <span>
            <i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'var(--muted)', opacity: 0.45 }} />
            within run
          </span>
          {layers.map((l, i) => (
            <span key={i} style={{ opacity: l.on ? 1 : 0.5 }}>
              <i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: layerColor(i) }} />
              {l.name}
            </span>
          ))}
        </div>
      </div>

      {/* dial in */}
      <div className="border-t border-line pt-2">
        <div className="label mb-1">dial in from real results</div>
        <textarea
          className="mono h-[70px] w-full text-[11px]"
          placeholder={`c,${layers.map((l) => l.name).join(',')},y\n0,${layers.map((_, i) => String.fromCharCode(65 + i) + '1').join(',')},48.1\n…`}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <div className="mt-1 flex items-center gap-2">
          <button className="btn" disabled={!csv.trim() || busy} onClick={estimate} title="Estimate each layer's size from the data (crossed ANOVA per level, fit across levels)">
            {busy ? 'Estimating…' : 'Estimate'}
          </button>
          {res && (
            <button className="link" onClick={adopt} title="Replace the predicted sizes with the measured ones (one undo step)">
              Adopt measured
            </button>
          )}
          {err && <span className="text-[11px] text-bad">{err}</span>}
        </div>
        {res && (
          <div className="mt-2">
            <div className="grid text-[10.5px] text-muted" style={{ gridTemplateColumns: '1fr 58px 58px' }}>
              <span />
              <span className="text-right">predicted</span>
              <span className="text-right">measured</span>
            </div>
            {res.layers.map((l, i) => (
              <div key={l.name} className="border-t border-line py-0.5">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium" style={{ color: layerColor(layers.findIndex((x) => x.name === l.name) ?? i) }}>
                    {l.name}
                  </span>
                  <span className="text-[10.5px] text-muted" title="90% range of the true SD relative to the estimate, given how many units the data had">
                    {l.units} units{l.rough ? ` · true ${fmt(l.rough[0], 2)}–${fmt(l.rough[1], 2)}×` : ''}
                  </span>
                </div>
                {(
                  [
                    ['offset SD', 'offsetSd', false],
                    ['CV', 'cv', true],
                    ['gain CV', 'gainCv', true],
                  ] as const
                ).map(([label, key, isPct]) => (
                  <div key={key} className="grid text-[11px]" style={{ gridTemplateColumns: '1fr 58px 58px' }}>
                    <span className="text-muted">{label}</span>
                    <span className="text-right">{isPct ? `${fmt(100 * l.predicted[key], 3)}%` : fmt(l.predicted[key], 3)}</span>
                    <span className="text-right font-medium">{isPct ? `${fmt(100 * l.measured[key], 3)}%` : fmt(l.measured[key], 3)}</span>
                  </div>
                ))}
              </div>
            ))}
            {res.notes.map((n, i) => (
              <div key={i} className="mt-1 text-[10.5px] text-muted">
                · {n}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
