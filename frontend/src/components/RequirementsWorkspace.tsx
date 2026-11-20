/**
 * Requirements workspace (spec §17, §21): the client's needs as sentences with numbers in them. Each one is met or
 * not, shows the measured value and, when not met, how much tighter the noise would have to be.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fmt, pct2, withUnits } from '../format'
import { METRIC_LABEL } from '../math/metrics'
import type { RequirementResult } from '../math/requirements'
import { kText } from '../math/rule'
import type { Requirement, RequirementKind, Series } from '../math/types'
import type { Derived } from '../state/derived'
import { useStore } from '../state/store'
import { Dot, Page, Verdict } from './kit'
import { IconX } from './ui'

/** A number inside a sentence: looks like text until hovered or focused. */
function Inline({ value, onCommit, width = 54, pct = false }: { value: number | null | undefined; onCommit: (v: number | null) => void; width?: number; pct?: boolean }) {
  const show = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(+(pct ? v * 100 : v).toPrecision(4)))
  const [t, setT] = useState(show(value))
  const focus = useRef(false)
  useEffect(() => {
    if (!focus.current) setT(show(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      type="text"
      inputMode="decimal"
      className="inline-num"
      style={{ width }}
      value={t}
      placeholder="?"
      onFocus={(e) => {
        focus.current = true
        e.target.select()
      }}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => {
        focus.current = false
        const v = Number(t.replace(',', '.'))
        onCommit(t.trim() === '' || !Number.isFinite(v) ? null : pct ? v / 100 : v)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/** The requirement as a plain sentence (report, tooltips). */
export function requirementText(r: Requirement, s: Pick<Series, 'units' | 'limits'>): string {
  const u = s.units
  switch (r.kind) {
    case 'detect':
      return `Detect ${withUnits(r.c, u)}`
    case 'distinguish':
      return `Tell ${fmt(r.c)} from ${withUnits(r.c2, u)}`
    case 'precision':
      return `Measure ${withUnits(r.c, u)} within ${fmt((r.cv ?? 0) * 100, 3)}% CV`
    case 'range':
      return `Quantify from ${fmt(r.c)} to ${withUnits(r.c2, u)} within ${fmt((r.cv ?? s.limits.cv) * 100, 3)}% CV`
    case 'levels':
      return `Resolve at least ${r.n ?? '?'} levels`
  }
}

/** What was measured, and the gap when it is not met. */
export function requirementFinding(r: RequirementResult, s: Pick<Series, 'units' | 'metric' | 'kTarget'>): { found: string; gap: string | null } {
  if (r.error) return { found: 'fill in the numbers', gap: null }
  const u = s.units
  const found =
    r.kind === 'detect'
      ? r.value === null ? 'no detection limit in this range' : `LoD is ${withUnits(r.value, u)}`
      : r.kind === 'distinguish'
        ? `${METRIC_LABEL[s.metric]} ${fmt(r.value)} (needs ${kText(s.kTarget)})`
        : r.kind === 'precision'
          ? `CV there is ${pct2(r.value)}`
          : r.kind === 'range'
            ? r.value === null ? 'never within that CV' : `quantifiable from ${withUnits(r.value, u)}`
            : `${fmt(r.value)} resolvable levels`
  const gap = r.ok ? null : r.sdScale === null ? 'tighter noise alone will not get there' : `met if the noise were ${fmt(r.sdScale, 2)}× of today`
  return { found, gap }
}

const ADD: [RequirementKind, string, string][] = [
  ['detect', 'Detect', 'The assay must detect a low concentration (LoD at or below it)'],
  ['distinguish', 'Tell apart', 'Two concentrations must be resolved by the pass rule'],
  ['precision', 'Precision', 'The result must be within a CV at one concentration'],
  ['range', 'Quantify range', 'Results must be within a CV across a whole range'],
  ['levels', 'Levels', 'A minimum number of resolvable levels'],
]

export function RequirementsWorkspace({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const setUi = useStore((s) => s.setUi)
  const notify = useStore((s) => s.notify)
  const { series: s, model: m, requirements: chk, limits: lim } = d
  const reqs = s.requirements
  const set = (i: number, p: Partial<Requirement>) => patch({ requirements: reqs.map((r, k) => (k === i ? { ...r, ...p } : r)) })
  const r3 = (x: number) => +x.toPrecision(2)
  const add = (kind: RequirementKind) => {
    const lod = lim?.lod?.c ?? m.cMax / 50
    const mid = m.levels.filter((c) => c > 0)
    const def: Record<RequirementKind, Requirement> = {
      detect: { kind, c: r3(lod * 1.5) },
      distinguish: { kind, c: mid[0] ?? r3(m.cMax / 10), c2: mid[1] ?? r3(m.cMax / 5) },
      precision: { kind, c: mid[Math.floor(mid.length / 2)] ?? r3(m.cMax / 4), cv: 0.2 },
      range: { kind, c: r3(lim?.loq?.c ?? lod * 2), c2: r3(lim?.uloq?.c ?? m.cMax / 2), cv: s.limits.cv },
      levels: { kind, n: Math.max(2, d.resolvable.length - 1) },
    }
    patch({ requirements: [...reqs, def[kind]] })
  }
  const u = s.units ? <span className="text-muted"> {s.units}</span> : null
  const sentence = (r: Requirement, i: number): ReactNode => {
    switch (r.kind) {
      case 'detect':
        return (
          <>
            Detect <Inline value={r.c} onCommit={(c) => set(i, { c })} />
            {u}
          </>
        )
      case 'distinguish':
        return (
          <>
            Tell <Inline value={r.c} onCommit={(c) => set(i, { c })} /> from <Inline value={r.c2} onCommit={(c2) => set(i, { c2 })} />
            {u}
          </>
        )
      case 'precision':
        return (
          <>
            Measure <Inline value={r.c} onCommit={(c) => set(i, { c })} />
            {u} within <Inline value={r.cv} pct width={40} onCommit={(cv) => set(i, { cv })} />% CV
          </>
        )
      case 'range':
        return (
          <>
            Quantify from <Inline value={r.c} onCommit={(c) => set(i, { c })} /> to <Inline value={r.c2} onCommit={(c2) => set(i, { c2 })} />
            {u} within <Inline value={r.cv ?? s.limits.cv} pct width={40} onCommit={(cv) => set(i, { cv })} />% CV
          </>
        )
      case 'levels':
        return (
          <>
            Resolve at least <Inline value={r.n} width={40} onCommit={(n) => set(i, { n: n === null ? null : Math.max(1, Math.round(n)) })} /> levels up to {withUnits(m.cMax, s.units)}
          </>
        )
    }
  }
  const all = chk.total > 0 && chk.met === chk.total
  return (
    <Page width={900}>
      <Verdict
        ok={chk.total ? all : undefined}
        sub={chk.total ? 'Each line is checked against the curve as it is now. Edit any number in place; turn on What if to see which change closes a gap.' : 'Write down what the assay has to do, in the client’s terms. Each line is checked live against the curve.'}
      >
        {chk.total ? (all ? `All ${chk.total} requirements are met.` : `${chk.met} of ${chk.total} requirements are met.`) : 'What does the assay need to do?'}
      </Verdict>

      {chk.total > 0 && (
        <div className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--hover)' }}>
          <div style={{ width: `${(100 * chk.met) / chk.total}%`, background: 'var(--good)', transition: 'width 200ms ease-out' }} />
        </div>
      )}

      <div className="flex flex-col">
        {chk.results.map((r, i) => {
          const f = requirementFinding(r, s)
          return (
            <div key={i} className="group flex items-start gap-3 border-t border-line py-3">
              <span className="pt-[7px]">
                <Dot ok={r.error ? null : r.ok} size={10} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] leading-8">{sentence(reqs[i], i)}</div>
                <div className="flex flex-wrap items-center gap-x-3 text-[12.5px]">
                  <span style={{ color: r.error ? 'var(--muted)' : r.ok ? 'var(--good)' : 'var(--bad)' }}>{f.found}</span>
                  {f.gap && <span className="text-muted">{f.gap}</span>}
                  {r.kind === 'distinguish' && !r.error && (
                    <button className="link" onClick={() => setUi({ workspace: 'separate', sep: { a: r.c as number, b: r.c2 as number } })}>
                      Look closer
                    </button>
                  )}
                  {(r.kind === 'detect' || r.kind === 'range' || r.kind === 'precision') && !r.error && (
                    <button className="link" onClick={() => setUi({ workspace: 'limits' })}>
                      See limits
                    </button>
                  )}
                </div>
              </div>
              <input
                type="text"
                className="bare w-[170px] text-right text-[12px] text-muted"
                placeholder="client wording"
                value={reqs[i].label ?? ''}
                onChange={(e) => set(i, { label: e.target.value })}
                title="How the client phrases this requirement (shown in the report)"
              />
              <button
                className="btn ghost mt-1 text-faint opacity-0 group-hover:opacity-100"
                style={{ padding: '0 4px' }}
                title="Remove"
                onClick={() => {
                  patch({ requirements: reqs.filter((_, k) => k !== i) })
                  notify('Requirement removed')
                }}
              >
                <IconX />
              </button>
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          <span className="label mr-1">add</span>
          {ADD.map(([k, label, tip]) => (
            <button key={k} className="btn" title={tip} onClick={() => add(k)}>
              + {label}
            </button>
          ))}
        </div>
      </div>
    </Page>
  )
}
