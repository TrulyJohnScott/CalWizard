import { useRef, useState } from 'react'
import { exportExcel, saveJson } from '../api'
import { fmt } from '../format'
import { METRIC_LABEL } from '../math/metrics'
import { kForError, kText, pctText, ruleError } from '../math/rule'
import type { MetricKey } from '../math/types'
import type { Derived } from '../state/derived'
import { sanitizeSeries, useActive, useStore, type Theme } from '../state/store'
import { IconGear, IconRedo, IconUndo, NumField, Popover, Row, Seg } from './ui'

const K_DEFAULT: Record<MetricKey, number> = { dsum: 1, ssmd: 3, zprime: 0.5 }

function Settings() {
  const s = useActive()
  const ui = useStore((x) => x.ui)
  const setUi = useStore((x) => x.setUi)
  const patch = useStore((x) => x.patch)
  const replace = useStore((x) => x.replaceActive)
  const notify = useStore((x) => x.notify)
  const file = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState('')
  const sim = s.mode !== 'replicates'
  return (
    <div className="flex flex-col">
      {sim && (
        <>
          <Row label="Simulated n">
            <NumField value={s.sim.n} min={0} max={500} step={1} onCommit={(n) => patch({ sim: { ...s.sim, n: Math.round(n) } })} />
          </Row>
          <Row label="Seed">
            <NumField value={s.sim.seed} min={0} step={1} onCommit={(seed) => patch({ sim: { ...s.sim, seed: Math.round(seed) } })} />
          </Row>
        </>
      )}
      <Row label="Jitter %">
        <NumField value={ui.jitter} min={0} max={100} step={5} onCommit={(jitter) => setUi({ jitter })} />
      </Row>
      <Row label="Shading">
        <Seg value={ui.shading} options={[['band', 'Band'], ['heat', 'Heat'], ['lines', 'Lines']]} onChange={(shading) => setUi({ shading })} />
      </Row>
      <Row label="Gaussians on curve" title="each level's signal spread drawn sideways on the curve">
        <Seg value={ui.marginal ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => setUi({ marginal: v === 'on' })} />
      </Row>
      <Row label="Readings below" title="each replicate reading as a tick under its distribution (read back to concentration in c → S)">
        <Seg value={ui.histBars ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => setUi({ histBars: v === 'on' })} />
      </Row>
      <Row label="Signal label">
        <input type="text" className="w-[110px]" value={s.signalLabel} onChange={(e) => patch({ signalLabel: e.target.value })} />
      </Row>
      <Row label="Theme">
        <Seg<Theme> value={ui.theme} options={[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(theme) => setUi({ theme })} />
      </Row>
      <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
        <button className="btn" onClick={() => saveJson(s)}>
          Save JSON
        </button>
        <button className="btn" onClick={() => file.current?.click()}>
          Load JSON
        </button>
        {err && <span className="text-[11px] text-bad">{err}</span>}
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              const loaded = sanitizeSeries(JSON.parse(await f.text()))
              replace(loaded)
              notify(`Loaded “${loaded.name}”`)
              setErr('')
            } catch {
              setErr('Not a Cal Wizard file')
            }
          }}
        />
      </div>
    </div>
  )
}

/** Pass rule editor: metric, target k and the equivalent allowed error (spec section 12). */
function RuleEditor() {
  const s = useActive()
  const patch = useStore((x) => x.patch)
  const err = ruleError(s.metric, s.kTarget)
  return (
    <div className="flex flex-col">
      <Row label="Metric">
        <Seg<MetricKey>
          value={s.metric}
          options={[
            ['dsum', 'Δμ/Σσ', 'Separation over summed spread: (μ₂ − μ₁) / (σ₁ + σ₂). At 1 the ±1σ ranges just touch. Equal spreads: misread = Φ(−value).'],
            ['ssmd', 'SSMD', 'Strictly standardised mean difference: (μ₂ − μ₁) / √(σ₁² + σ₂²). 3 is the usual bar (≈1.7% misread with equal spreads).'],
            ['zprime', 'Z′', 'Z-prime: 1 − 3(σ₁ + σ₂) / |μ₂ − μ₁|. 1 = no spread; 0.5 is the classic “excellent” bar; ≤ 0 means the ±3σ ranges overlap.'],
          ]}
          onChange={(metric) => patch({ metric, kTarget: s.kTarget === K_DEFAULT[s.metric] ? K_DEFAULT[metric] : s.kTarget })}
        />
      </Row>
      <Row label="Target k" title="a neighbouring pair is resolved when the metric reaches this value">
        <NumField value={s.kTarget} step={s.metric === 'zprime' ? 0.1 : 0.5} onCommit={(kTarget) => patch({ kTarget })} />
      </Row>
      <Row label="Allowed error %" title="misread rate at the threshold for equal spreads; sets k">
        <NumField
          value={+(err * 100).toPrecision(3)}
          min={1e-9}
          max={49.9}
          step={0.5}
          width={72}
          onCommit={(pct) => {
            const k = kForError(s.metric, pct / 100)
            if (k !== null) patch({ kTarget: +k.toPrecision(4) })
          }}
        />
      </Row>
      <p className="mt-2 border-t border-line pt-2 text-[11.5px] leading-snug text-muted">
        Neighbouring levels count as resolved when {METRIC_LABEL[s.metric]} ≥ {kText(s.kTarget)}. With equal spreads, a single reading
        is then assigned to the wrong level {pctText(err)} of the time.
      </p>
    </div>
  )
}

/** "N resolvable levels" + the pass rule in plain words; always visible. */
function Headline({ d }: { d: Derived }) {
  const s = d.series
  const applyLadder = useStore((x) => x.applyLadder)
  const notify = useStore((x) => x.notify)
  const setUi = useStore((x) => x.setUi)
  const n = d.resolvable.length
  return (
    <div className="flex items-center gap-1">
      <button
        className="btn ghost"
        title={`Ladder from 0 to ${fmt(d.model.cMax)} ${s.units}: ${d.resolvable.map((c) => fmt(c, 4)).join(', ')}\nClick to use these as the levels`}
        onClick={() => {
          applyLadder(d.resolvable)
          setUi({ sidebar: true })
          if (s.mode === 'equations') notify(`Levels set to the ladder (${n})`)
        }}
      >
        <span className="font-semibold tabular-nums" data-testid="resolvable-count">
          {n}
        </span>
        <span className="text-muted">resolvable {n === 1 ? 'level' : 'levels'}</span>
      </button>
      <Popover
        align="left"
        trigger={(open, toggle) => (
          <button className="btn" data-on={open} onClick={toggle} title="Pass rule: when two neighbouring levels count as resolved" data-testid="rule-chip">
            {METRIC_LABEL[s.metric]} ≥ {kText(s.kTarget)}
            <span className="text-muted">· {pctText(ruleError(s.metric, s.kTarget))} misread</span>
          </button>
        )}
      >
        <RuleEditor />
      </Popover>
    </div>
  )
}

export function TopBar({ d }: { d: Derived }) {
  const s = useActive()
  const patch = useStore((x) => x.patch)
  const undo = useStore((x) => x.undo)
  const redo = useStore((x) => x.redo)
  const canUndo = useStore((x) => x.past.length > 0)
  const canRedo = useStore((x) => x.future.length > 0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
      <span className="font-semibold tracking-tight">Cal Wizard</span>
      <span className="text-faint">/</span>
      <input type="text" className="bare w-[150px] font-medium" value={s.name} placeholder="Name" onChange={(e) => patch({ name: e.target.value })} />
      <input type="text" className="bare w-[72px] text-muted" value={s.units} placeholder="units" onChange={(e) => patch({ units: e.target.value })} />
      <span className="mx-1 h-4 border-l border-line" />
      <Headline d={d} />
      <div className="flex-1" />
      <button className="btn ghost" style={{ padding: '0 5px' }} disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo">
        <IconUndo />
      </button>
      <button className="btn ghost" style={{ padding: '0 5px' }} disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
        <IconRedo />
      </button>
      <Popover trigger={(open, toggle) => (
        <button className="btn" data-on={open} onClick={toggle} title="Settings" style={{ padding: '0 6px' }}>
          <IconGear />
        </button>
      )}>
        <Settings />
      </Popover>
      <button
        className="btn"
        disabled={busy}
        title={err || 'Export to Excel'}
        style={err ? { color: 'var(--bad)' } : undefined}
        onClick={async () => {
          setBusy(true)
          setErr('')
          try {
            await exportExcel(s)
          } catch (e) {
            setErr(String(e instanceof Error ? e.message : e))
            setTimeout(() => setErr(''), 5000)
          }
          setBusy(false)
        }}
      >
        {err ? 'Export failed' : 'Export'}
      </button>
    </header>
  )
}
