import { useState } from 'react'
import { exportExcel, saveJson } from '../api'
import { fmt } from '../format'
import { METRIC_LABEL } from '../math/metrics'
import { kForError, kText, pctText, ruleError } from '../math/rule'
import type { MetricKey } from '../math/types'
import type { Derived } from '../state/derived'
import { useActive, useStore, type Theme, type Workspace } from '../state/store'
import { IconGrid, IconPlay, IconShare, IconWand } from './kit'
import { copyShareLink, saveReportHtml } from './Present'
import { IconGear, IconRedo, IconUndo, NumField, Popover, Row, Seg } from './ui'

const K_DEFAULT: Record<MetricKey, number> = { dsum: 1, ssmd: 3, zprime: 0.5 }

/** The workspaces, in the order a project usually moves through them (spec §21). */
export const WORKSPACES: { id: Workspace; label: string; tip: string; soon?: boolean }[] = [
  { id: 'curve', label: 'Curve', tip: 'Define the curve and its noise, place levels and anchors (1)' },
  { id: 'separate', label: 'Separate', tip: 'Two concentrations in depth: can the assay tell them apart? (2)' },
  { id: 'limits', label: 'Limits', tip: 'LoB, LoD, LoQ and the experiment that confirms them (3)' },
  { id: 'read', label: 'Read', tip: 'A sheet that turns signals into concentrations (4)' },
  { id: 'requirements', label: 'Requirements', tip: 'What the assay must do, checked against the curve (5)' },
  { id: 'strips', label: 'Strips', tip: 'Simulated strips: a place kept for the strip viewer (6)', soon: true },
]

function Settings() {
  const s = useActive()
  const ui = useStore((x) => x.ui)
  const setUi = useStore((x) => x.setUi)
  const patch = useStore((x) => x.patch)
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
      <Row label="Limits on curve" title="LoD and LoQ marked on the concentration axis">
        <Seg value={ui.showLimits ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => setUi({ showLimits: v === 'on' })} />
      </Row>
      <Row label="Theme">
        <Seg<Theme> value={ui.theme} options={[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(theme) => setUi({ theme })} />
      </Row>
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
  const was = d.baseline?.resolvable
  return (
    <div className="flex items-center gap-1">
      <button
        className="btn ghost"
        title={`Ladder from 0 to ${fmt(d.model.cMax)} ${s.units}: ${d.resolvable.map((c) => fmt(c, 4)).join(', ')}\nClick to use these as the levels`}
        onClick={() => {
          applyLadder(d.resolvable)
          setUi({ sidebar: true, workspace: 'curve' })
          if (s.mode === 'equations') notify(`Levels set to the ladder (${n})`)
        }}
      >
        {was !== undefined && was !== n && <span className="text-muted line-through">{was}</span>}
        <span className="font-semibold tabular-nums" data-testid="resolvable-count">
          {n}
        </span>
        <span className="text-muted">resolvable {n === 1 ? 'level' : 'levels'}</span>
      </button>
      <Popover
        align="right"
        trigger={(open, toggle) => (
          <button className="btn" data-on={open} onClick={toggle} title="Pass rule: when two neighbouring levels count as resolved" data-testid="rule-chip">
            {METRIC_LABEL[s.metric]} ≥ {kText(s.kTarget)}
            <span className="rule-extra text-muted">· {pctText(ruleError(s.metric, s.kTarget))} misread</span>
          </button>
        )}
      >
        <RuleEditor />
      </Popover>
    </div>
  )
}

/** Name, analyte, units and signal label: the words every axis, sentence and export uses. */
function Labels() {
  const s = useActive()
  const patch = useStore((x) => x.patch)
  const field = (label: string, key: 'name' | 'analyte' | 'units' | 'signalLabel', placeholder: string) => (
    <Row label={label}>
      <input type="text" className="w-[150px]" value={s[key]} placeholder={placeholder} onChange={(e) => patch({ [key]: e.target.value })} />
    </Row>
  )
  return (
    <Popover
      align="left"
      trigger={(open, toggle) => (
        <button className="btn ghost min-w-0" data-on={open} onClick={toggle} title="Name, analyte, units and signal label">
          <span className="truncate font-medium" style={{ maxWidth: 150 }}>
            {s.name || 'Untitled'}
          </span>
          <span className="labels-extra truncate text-muted" style={{ maxWidth: 150 }}>
            {[s.analyte, s.units].filter(Boolean).join(' · ')}
          </span>
        </button>
      )}
    >
      <div className="flex flex-col">
        {field('Name', 'name', 'Lot 3 run')}
        {field('Analyte', 'analyte', 'CRP')}
        {field('Units', 'units', 'ng/mL')}
        {field('Signal', 'signalLabel', 'T/C ratio')}
        <p className="mt-2 border-t border-line pt-2 text-[11.5px] leading-snug text-muted">These label every axis, sentence, report and export.</p>
      </div>
    </Popover>
  )
}

function ShareMenu({ d }: { d: Derived }) {
  const s = useActive()
  const notify = useStore((x) => x.notify)
  const setPresent = useStore((x) => x.setPresent)
  const openDialog = useStore((x) => x.openDialog)
  const pair = useStore((x) => x.ui.sep)
  const [err, setErr] = useState('')
  const item = (label: string, hint: string, run: () => void | Promise<void>) => (
    <button className="menu-item" onClick={() => void run()}>
      <span>{label}</span>
      <span className="text-[11px] text-muted">{hint}</span>
    </button>
  )
  return (
    <Popover
      trigger={(open, toggle) => (
        <button className="btn" data-on={open} onClick={toggle} title="Share, export, print">
          <IconShare />
          <span className="btn-text">Share</span>
        </button>
      )}
    >
      <div className="flex flex-col">
        {item('Copy link', 'the whole assay rides in the link; nothing is uploaded', async () => notify((await copyShareLink(d)) ? 'Link copied' : 'Could not copy the link', false))}
        {item('Save report as HTML', 'one file anyone can open in a browser', () => saveReportHtml(d, pair))}
        {item('Print or save as PDF', 'opens the report, then the print dialog', () => {
          setPresent(true)
          setTimeout(() => window.print(), 350)
        })}
        <div className="my-1 border-t border-line" />
        {item('Excel workbook', 'live formulas for the curve and the levels', async () => {
          setErr('')
          try {
            await exportExcel(s)
          } catch (e) {
            setErr(String(e instanceof Error ? e.message : e))
          }
        })}
        {item('Save as JSON', 'reopen later, or use with the calwizard CLI', () => saveJson(s))}
        {item('Open…', 'a saved assay, a report, or reader data', () => openDialog('start'))}
        {err && <span className="px-2 pt-1 text-[11px] text-bad">{err}</span>}
      </div>
    </Popover>
  )
}

export function TopBar({ d }: { d: Derived }) {
  const undo = useStore((x) => x.undo)
  const redo = useStore((x) => x.redo)
  const canUndo = useStore((x) => x.past.length > 0)
  const canRedo = useStore((x) => x.future.length > 0)
  const ws = useStore((x) => x.ui.workspace)
  const whatIf = useStore((x) => x.ui.whatIf)
  const setUi = useStore((x) => x.setUi)
  const openDialog = useStore((x) => x.openDialog)
  const setPresent = useStore((x) => x.setPresent)
  return (
    <header className="topbar flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3">
      <button className="btn ghost" onClick={() => openDialog('start')} title="Examples and your own data" style={{ padding: '0 6px' }}>
        <IconGrid />
        <span className="font-semibold tracking-tight">Cal Wizard</span>
      </button>
      <span className="text-faint">/</span>
      <Labels />
      <nav className="tabs ml-2 flex items-center" role="tablist" aria-label="Workspace">
        {WORKSPACES.map((w) => (
          <button key={w.id} role="tab" aria-selected={ws === w.id} className="tab" data-soon={w.soon || undefined} title={w.tip} onClick={() => setUi({ workspace: w.id })}>
            {w.label}
          </button>
        ))}
      </nav>
      <div className="flex-1" />
      <Headline d={d} />
      <span className="mx-0.5 h-4 border-l border-line" />
      <button className="btn" data-on={whatIf || d.model.adjusted} onClick={() => setUi({ whatIf: !whatIf })} title="What if: move the background, the top, the midpoint or the noise and watch every claim follow" style={d.model.adjusted ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}>
        <IconWand />
        <span className="btn-text">What if</span>
      </button>
      <button className="btn ghost" style={{ padding: '0 5px' }} disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo">
        <IconUndo />
      </button>
      <button className="btn ghost" style={{ padding: '0 5px' }} disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
        <IconRedo />
      </button>
      <ShareMenu d={d} />
      <button className="btn" onClick={() => setPresent(true)} title="Present: the report full-screen, nothing editable (P)">
        <IconPlay />
        <span className="btn-text">Present</span>
      </button>
      <Popover
        trigger={(open, toggle) => (
          <button className="btn ghost" data-on={open} onClick={toggle} title="Settings" style={{ padding: '0 6px' }}>
            <IconGear />
          </button>
        )}
      >
        <Settings />
      </Popover>
    </header>
  )
}
