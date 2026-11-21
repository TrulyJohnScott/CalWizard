import { useState } from 'react'
import { exportExcel, saveJson } from '../api'
import { fmt, withUnits } from '../format'
import { kForError, kText, pctText, ruleError } from '../math/rule'
import type { MetricKey } from '../math/types'
import type { Derived } from '../state/derived'
import { steps } from '../state/points'
import { useActive, useStore, type Theme, type Workspace } from '../state/store'
import { IconGrid, IconShare } from './kit'
import { copyShareLink, saveReportHtml } from './Present'
import { IconGear, IconRedo, IconUndo, NumField, Popover, Row, Seg } from './ui'

const K_DEFAULT: Record<MetricKey, number> = { dsum: 3, ssmd: 3, zprime: 0.5 }
/** the two separation rules (core design): Classify = N·(σ₁+σ₂), Order = N·√(σ₁²+σ₂²) */
export const RULE_NAME: Record<MetricKey, string> = { dsum: 'Classify', ssmd: 'Order', zprime: 'Z′' }
export const RULE_GAP: Record<MetricKey, string> = { dsum: 'σ₁+σ₂', ssmd: '√(σ₁²+σ₂²)', zprime: '3(σ₁+σ₂)' }

/** The workspaces, in the order a project usually moves through them (spec §21). */
export const WORKSPACES: { id: Workspace; label: string; tip: string; soon?: boolean }[] = [
  { id: 'curve', label: 'Curve', tip: 'Define the curve and its noise, place levels and anchors (1)' },
  { id: 'separate', label: 'Separate', tip: 'Two concentrations in depth: can the assay tell them apart? (2)' },
  { id: 'limits', label: 'Limits', tip: 'LoB, LoD, LoQ and the experiment that confirms them (3)' },
  { id: 'read', label: 'Read', tip: 'A sheet that turns signals into concentrations (4)' },
  { id: 'variability', label: 'Variability', tip: 'Lots, readers, days: what each source costs, the experiment across them, and dial-in from real results (5)' },
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
      <Row label="Axes" title="Concentration across (the usual), or signal across">
        <Seg value={ui.flip ? 's2c' : 'c2s'} options={[['c2s', 'c → S'], ['s2c', 'S → c']]} onChange={(v) => setUi({ flip: v === 's2c' })} />
      </Row>
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
      <Row label="Rule">
        <Seg<MetricKey>
          value={s.metric}
          options={[
            ['dsum', 'Classify', 'Gap ≥ N × (σ₁ + σ₂): a single reading lands on its own side of the threshold. N = 3: about 1 misread in 740. The usual choice for product claims.'],
            ['ssmd', 'Order', 'Gap ≥ N × √(σ₁² + σ₂²) (SSMD): one reading of each comes out in the right order. Looser for single readings; for comparing lots or conditions.'],
          ]}
          onChange={(metric) => patch({ metric, kTarget: s.kTarget === K_DEFAULT[s.metric] ? K_DEFAULT[metric] : s.kTarget })}
        />
      </Row>
      <Row label="N" title="how many of the spreads must fit between neighbouring means">
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
        Neighbours count as apart when their means differ by at least {kText(s.kTarget)} × ({RULE_GAP[s.metric]}). With equal spreads, a
        single reading is then misread {pctText(err)} of the time.
      </p>
    </div>
  )
}

/** "N resolvable levels" + the pass rule in plain words; always visible. */
function Headline({ d }: { d: Derived }) {
  const s = d.series
  const measure = useStore((x) => x.measure)
  const pts = (measure?.pts ?? []).filter((c) => c > 0)
  const u = s.units
  const lod = d.limits?.lod?.c ?? null
  let text: string
  let bad = false
  if (pts.length) {
    const st = steps(s, d.model, pts)
    const ok = st.filter((x) => x.q >= 1).length
    bad = ok < st.length
    text = `your ${st.length + 1} concentrations: ${ok} of ${st.length} steps apart`
  } else {
    const n = d.resolvable.length - 1
    bad = n < 1
    text = n < 1 ? 'none apart from the blank' : `${n} step${n === 1 ? '' : 's'} apart · 0–${fmt(d.resolvable[d.resolvable.length - 1])} ${u}`
  }
  return (
    <div className="flex items-center gap-1">
      <span className="px-1.5 text-[12.5px]" data-testid="resolvable-count" style={{ color: bad ? 'var(--bad)' : undefined }}>
        {text}
        {lod !== null && <span className="text-muted"> · detects {withUnits(lod, u)}</span>}
      </span>
      <Popover
        align="right"
        trigger={(open, toggle) => (
          <button className="btn" data-on={open} onClick={toggle} title="Pass rule: when two neighbouring levels count as resolved" data-testid="rule-chip">
            {RULE_NAME[s.metric]} · N {kText(s.kTarget)}
            <span className="rule-extra text-muted">· {pctText(ruleError(s.metric, s.kTarget))} misread</span>
          </button>
        )}
      >
        <RuleEditor />
      </Popover>
      <button className="btn ghost" style={{ padding: '0 7px' }} title="What the separation rule means" aria-label="Explain the separation rule" onClick={() => useStore.getState().setUi({ explain: !useStore.getState().ui.explain })}>
        ?
      </button>
    </div>
  )
}

/** Name, analyte, units and signal label: the words every axis, sentence and export uses. */
export function Labels() {
  const s = useActive()
  const patch = useStore((x) => x.patch)
  const all = useStore((x) => x.series)
  const select = useStore((x) => x.selectCondition)
  const add = useStore((x) => x.addCondition)
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
            {[s.analyte, s.units, all.length > 1 ? `${all.findIndex((x) => x.id === s.id) + 1} of ${all.length}` : ''].filter(Boolean).join(' · ')}
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
        <div className="mt-2 flex flex-col border-t border-line pt-2">
          <span className="label mb-1">Conditions</span>
          {all.map((x) => (
            <button key={x.id} className="menu-item" style={{ flexDirection: 'row', fontWeight: x.id === s.id ? 600 : 400 }} onClick={() => select(x.id)}>
              <span className="mr-1.5 text-accent">{x.id === s.id ? '●' : '○'}</span>
              <span className="truncate">{x.name || 'Untitled'}</span>
            </button>
          ))}
          <button className="link mt-1 self-start" onClick={() => add(`${s.name} ${all.length + 1}`)} title="Another lot, reader or day: starts as a copy, then paste or import its own data">
            + Add a condition
          </button>
        </div>
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
  const openDialog = useStore((x) => x.openDialog)
  return (
    <header className="topbar flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3">
      <button className="btn ghost" onClick={() => openDialog('start')} title="Examples and your own data" style={{ padding: '0 6px' }}>
        <IconGrid />
        <span className="font-semibold tracking-tight">Cal Wizard</span>
      </button>
      <div className="flex-1" />
      <Headline d={d} />
      <span className="mx-0.5 h-4 border-l border-line" />
      <button className="btn ghost" style={{ padding: '0 5px' }} disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo">
        <IconUndo />
      </button>
      <button className="btn ghost" style={{ padding: '0 5px' }} disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
        <IconRedo />
      </button>
      <ShareMenu d={d} />
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
