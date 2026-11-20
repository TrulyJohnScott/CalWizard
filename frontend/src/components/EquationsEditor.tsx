import { useEffect, useRef, useState } from 'react'
import { compileExpr } from '../math/expr'
import { MEAN_PRESETS, SD_PRESETS, type Preset } from '../math/presets'
import { useStore } from '../state/store'
import type { Derived } from '../state/derived'
import { NumField } from './ui'

function ExprField({
  label,
  variable,
  value,
  presets,
  onCommit,
}: {
  label: string
  variable: 'c' | 'S'
  value: string
  presets: Preset[]
  onCommit: (v: string) => void
}) {
  const [text, setText] = useState(value)
  const [err, setErr] = useState<{ msg: string; pos: number } | null>(null)
  const last = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | 0>(0)
  useEffect(() => {
    if (value !== last.current) {
      last.current = value
      setText(value)
      setErr(null)
    }
  }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])
  const check = (t: string) => {
    const r = compileExpr(t, variable)
    if (r.ok) {
      setErr(null)
      if (t !== last.current) {
        last.current = t
        onCommit(t)
      }
    } else setErr({ msg: r.error, pos: r.pos })
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="mono text-muted">{label}</span>
        <select
          value=""
          title="Presets"
          className="w-[78px] text-[11px] text-muted"
          onChange={(e) => {
            const p = presets.find((x) => x.label === e.target.value)
            if (p) {
              setText(p.expr)
              check(p.expr)
            }
          }}
        >
          <option value="">preset</option>
          {presets.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <input
        type="text"
        spellCheck={false}
        className="mono w-full"
        style={err ? { borderColor: 'var(--bad)' } : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          clearTimeout(timer.current)
          const t = e.target.value
          timer.current = setTimeout(() => check(t), 120)
        }}
        onBlur={() => check(text)}
      />
      {err && (
        <div className="mt-1 text-[11px] text-bad">
          {err.msg} <span className="text-muted">(at {err.pos + 1})</span>
        </div>
      )}
    </div>
  )
}

export function EquationsEditor({ d }: { d: Derived }) {
  const patch = useStore((s) => s.patch)
  const { series } = d
  return (
    <div className="flex flex-col gap-3">
      <ExprField label="mean(c) =" variable="c" value={series.meanExpr} presets={MEAN_PRESETS} onCommit={(meanExpr) => patch({ meanExpr })} />
      <ExprField label="sd(S) =" variable="S" value={series.sdExpr} presets={SD_PRESETS} onCommit={(sdExpr) => patch({ sdExpr })} />
      <div className="flex items-center justify-between">
        <span className="label">c max</span>
        <NumField value={series.cMax} min={1e-9} step={Math.max(1, Math.round(series.cMax / 50))} width={72} onCommit={(cMax) => patch({ cMax })} />
      </div>
    </div>
  )
}
