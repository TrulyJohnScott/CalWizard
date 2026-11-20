/**
 * The report (spec §20, §21): one read-only page of everything the series supports. The same component is the
 * presentation mode, the print layout and the exported HTML file, so it uses only its own `rp-` classes
 * (REPORT_CSS) and SVG figures: no Tailwind, no Plotly.
 */
import { areaPath, Chart, Label, linePath, linspace } from '../charts/svg'
import { signalRange } from '../charts/common'
import { concLabel, fmt, pct2, withUnits } from '../format'
import { pairRows } from '../math/analysis'
import { METRIC_LABEL } from '../math/metrics'
import { FLAG_TEXT, readback } from '../math/readback'
import { ruleText } from '../math/rule'
import { separate } from '../math/separate'
import { adjustText } from '../math/whatif'
import type { Derived } from '../state/derived'
import { DetectPlot, limitsSentence, ProfilePlot } from './LimitsWorkspace'
import { requirementFinding, requirementText } from './RequirementsWorkspace'
import { PairPlot, separationSentence } from './SeparateWorkspace'

export const REPORT_CSS = `
.rp-root{--bg:#ffffff;--panel:#ffffff;--fg:#16161a;--muted:#6b6b76;--faint:#a1a1aa;--line:#e4e4e8;--grid:#f0f0f2;--hover:#f4f4f5;
--accent:#4c5bd4;--bad:#c0474d;--warm:#d9822b;--good:#2f9e6e;--teal:#1f9d8f;
--font:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
font-family:var(--font);color:var(--fg);background:var(--bg);font-size:14px;line-height:1.5;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.rp-root.rp-dark{--bg:#0d0d0f;--panel:#131316;--fg:#ececef;--muted:#9a9aa5;--faint:#5f5f69;--line:#26262b;--grid:#1c1c20;--hover:#1a1a1e;
--accent:#8e99f2;--bad:#e07a80;--warm:#e59a4f;--good:#4cc38a;--teal:#4fc4b4}
.rp-page{max-width:920px;margin:0 auto;padding:40px 36px 56px}
.rp-sec{padding:28px 0;border-top:1px solid var(--line)}
.rp-sec:first-child{border-top:0;padding-top:0}
.rp-kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;margin:0 0 8px}
.rp-title{font-size:34px;line-height:1.15;font-weight:650;letter-spacing:-.02em;margin:0}
.rp-sub{color:var(--muted);margin:6px 0 0;font-size:14px}
.rp-h{font-size:21px;line-height:1.3;font-weight:620;letter-spacing:-.01em;margin:0 0 6px}
.rp-p{margin:0;color:var(--muted);max-width:72ch}
.rp-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;margin-top:26px}
.rp-tile b{display:block;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.15}
.rp-tile span{display:block;font-size:11.5px;color:var(--muted)}
.rp-tile small{display:block;font-size:11.5px;color:var(--muted)}
.rp-two{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:16px}
.rp-fig{margin-top:14px}
.rp-cap{font-size:11.5px;color:var(--muted);margin:0 0 4px}
.rp-table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
.rp-table th{font-weight:500;color:var(--muted);text-align:right;padding:5px 8px;font-size:11.5px}
.rp-table td{text-align:right;padding:6px 8px;border-top:1px solid var(--line)}
.rp-table th:first-child,.rp-table td:first-child{text-align:left;padding-left:0}
.rp-table th.l,.rp-table td.l{text-align:left}
.rp-dot{display:inline-block;width:9px;height:9px;border-radius:9px;margin-right:8px;vertical-align:baseline}
.rp-good{color:var(--good)}.rp-bad{color:var(--bad)}.rp-muted{color:var(--muted)}
.rp-req{display:flex;gap:10px;align-items:baseline;padding:9px 0;border-top:1px solid var(--line)}
.rp-req:first-child{border-top:0}
.rp-req div{flex:1}
.rp-req b{font-weight:560;font-size:15px}
.rp-foot{font-size:11.5px;color:var(--muted);line-height:1.6}
.rp-foot code{font-family:ui-monospace,Consolas,monospace;font-size:11px}
.rp-slot{border:1px dashed var(--line);border-radius:10px;padding:18px;color:var(--muted);font-size:12.5px;text-align:center}
@media (max-width:760px){.rp-tiles{grid-template-columns:repeat(2,1fr)}.rp-two{grid-template-columns:1fr}}
@media print{.rp-page{padding:0;max-width:none}.rp-sec{break-inside:avoid}}
`

/** The calibration curve as a static figure: band, mean, readings, levels and the detection limits. */
export function CurveFigure({ d, width, height = 300 }: { d: Derived; width?: number; height?: number }) {
  const { series: s, model: m, dots, limits: lim } = d
  const cs = linspace(0, m.cMax, 200)
  const [lo, hi] = signalRange(m, dots, null)
  return (
    <Chart width={width} height={height} x={[0, m.cMax]} y={[lo, hi]} xLabel={concLabel(s)} yLabel={s.signalLabel || 'Signal'}>
      {(c) => {
        const P = (v: number, k: number): [number, number] => [c.X(v), c.Y(m.mean(v) + k * m.sd(v))]
        const mark = (v: number | undefined, text: string, col: string, dy: number) =>
          v === undefined ? null : (
            <g>
              <line x1={c.X(v)} x2={c.X(v)} y1={c.t + dy + 4} y2={c.b} style={{ stroke: col, strokeDasharray: '3 3' }} />
              <Label x={c.X(v) + 3} y={c.t + dy} anchor="start" color={col} size={10.5} weight={600}>
                {text} {fmt(v)}
              </Label>
            </g>
          )
        return (
          <>
            <path d={areaPath(cs.map((v) => P(v, 2)), cs.map((v) => P(v, -2)))} style={{ fill: 'var(--accent)', opacity: 0.09 }} />
            <path d={areaPath(cs.map((v) => P(v, 1)), cs.map((v) => P(v, -1)))} style={{ fill: 'var(--accent)', opacity: 0.12 }} />
            {m.base && <path d={linePath(cs.map((v) => [c.X(v), c.Y(m.base!.mean(v))]))} style={{ fill: 'none', stroke: 'var(--muted)', strokeWidth: 1.2, strokeDasharray: '5 4' }} />}
            <path d={linePath(cs.map((v) => P(v, 0)))} style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 2 }} />
            {s.mode === 'replicates' && dots.flatMap((l) => l.ys.map((y, i) => <circle key={`${l.c}-${i}`} cx={c.X(l.c)} cy={c.Y(y)} r={2.2} style={{ fill: 'var(--fg)', opacity: 0.35 }} />))}
            {d.resolvable.map((v) => (
              <line key={`t${v}`} x1={c.X(v)} x2={c.X(v)} y1={c.b - 6} y2={c.b} style={{ stroke: 'var(--accent)', strokeWidth: 1.5, opacity: 0.6 }} />
            ))}
            {m.levels.map((v) => (
              <circle key={v} cx={c.X(v)} cy={c.Y(m.mean(v))} r={4} style={{ fill: 'var(--bg)', stroke: 'var(--accent)', strokeWidth: 1.8 }} />
            ))}
            {lim && mark(lim.lod?.c, 'LoD', 'var(--muted)', 8)}
            {lim && mark(lim.loq?.c, 'LoQ', 'var(--good)', 22)}
          </>
        )
      }}
    </Chart>
  )
}

export interface ReportOptions {
  /** fixed figure widths for the static export; measured on screen when omitted */
  static?: boolean
  dark?: boolean
  /** a pair to feature (the Separate workspace's), or null */
  pair?: { a: number; b: number } | null
  date?: string
}

export function Report({ d, opt = {} }: { d: Derived; opt?: ReportOptions }) {
  const { series: s, model: m, limits: lim, requirements: chk } = d
  const u = s.units
  const W = opt.static ? 848 : undefined
  const half = opt.static ? 410 : undefined
  const rows = pairRows(m, m.levels, s.metric, s.kTarget)
  const n = d.resolvable.length
  const read = s.samples.length ? readback(m, s.samples, s.limits, 0.95) : null
  let sep = null
  if (opt.pair && opt.pair.a !== opt.pair.b) {
    try {
      sep = separate(m, opt.pair.a, opt.pair.b, s.metric, s.kTarget, { runs: 300 })
    } catch {
      sep = null
    }
  }
  const dot = (ok: boolean) => <span className="rp-dot" style={{ background: ok ? 'var(--good)' : 'var(--bad)' }} />
  const source =
    s.mode === 'equations' ? (
      <>
        mean(c) = <code>{s.meanExpr}</code>; sd(S) = <code>{s.sdExpr}</code>
      </>
    ) : s.mode === 'replicates' ? (
      `replicate readings at ${m.levels.length} concentrations (interpolated between them)`
    ) : (
      `mean and SD entered at ${m.levels.length} concentrations (interpolated between them)`
    )
  return (
    <div className={`rp-root${opt.dark ? ' rp-dark' : ''}`}>
      <div className="rp-page">
        <section className="rp-sec" data-slide>
          <p className="rp-kicker">Assay resolution summary{opt.date ? ` · ${opt.date}` : ''}</p>
          <h1 className="rp-title">{s.name || 'Untitled'}</h1>
          <p className="rp-sub">
            {[s.analyte, u, s.signalLabel].filter(Boolean).join(' · ')}
            {m.adjusted && m.adjust ? ` · what-if: ${adjustText(m.adjust, (x) => fmt(x))}` : ''}
          </p>
          <div className="rp-tiles">
            <div className="rp-tile">
              <span>Resolvable levels</span>
              <b>{n}</b>
              <small>0 to {withUnits(m.cMax, u)}</small>
            </div>
            <div className="rp-tile">
              <span>Limit of detection</span>
              <b>{fmt(lim?.lod?.c)}</b>
              <small>{u || ' '}</small>
            </div>
            <div className="rp-tile">
              <span>Quantifiable range</span>
              <b>{lim?.loq && lim.uloq ? `${fmt(lim.loq.c)} – ${fmt(lim.uloq.c)}` : '–'}</b>
              <small>within {fmt(s.limits.cv * 100, 3)}% CV</small>
            </div>
            {chk.total > 0 ? (
              <div className="rp-tile">
                <span>Requirements met</span>
                <b className={chk.met === chk.total ? 'rp-good' : 'rp-bad'}>
                  {chk.met} of {chk.total}
                </b>
                <small> </small>
              </div>
            ) : (
              <div className="rp-tile">
                <span>Pass rule</span>
                <b>{METRIC_LABEL[s.metric]} ≥ {fmt(s.kTarget)}</b>
                <small>{ruleText(s.metric, s.kTarget).split('·')[1]?.trim()}</small>
              </div>
            )}
          </div>
        </section>

        <section className="rp-sec" data-slide>
          <p className="rp-kicker">The curve</p>
          <h2 className="rp-h">
            {n} concentrations can be told apart between 0 and {withUnits(m.cMax, u)}.
          </h2>
          <p className="rp-p">The line is the mean signal; the bands are ±1 and ±2 standard deviations of a single reading. Ticks on the axis mark each resolvable step.</p>
          <div className="rp-fig">
            <CurveFigure d={d} width={W} />
          </div>
          {rows.length > 0 && (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Neighbouring levels{u ? ` (${u})` : ''}</th>
                  <th>Signal</th>
                  <th>CV</th>
                  <th>{METRIC_LABEL[s.metric]}</th>
                  <th>Misread</th>
                  <th className="l">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.c1}-${r.c2}`}>
                    <td>
                      {fmt(r.c1)} → {fmt(r.c2)}
                    </td>
                    <td>
                      {fmt(r.mu1, 4)} → {fmt(r.mu2, 4)}
                    </td>
                    <td>{pct2(r.sd2 / Math.abs(r.mu2))}</td>
                    <td>{fmt(r[s.metric])}</td>
                    <td>{pct2(r.err)}</td>
                    <td className="l">
                      {dot(r.pass)}
                      {r.pass ? 'yes' : 'not yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {sep && (
          <section className="rp-sec" data-slide>
            <p className="rp-kicker">A closer look</p>
            <h2 className="rp-h">{separationSentence(sep, u).head}</h2>
            <p className="rp-p">{separationSentence(sep, u).sub}</p>
            <div className="rp-fig">
              <PairPlot r={sep} units={u} signalLabel={s.signalLabel || 'Signal'} width={W} height={240} />
            </div>
          </section>
        )}

        {lim && (
          <section className="rp-sec" data-slide>
            <p className="rp-kicker">Detection and quantitation</p>
            <h2 className="rp-h">{limitsSentence(lim, s)}</h2>
            <p className="rp-p">
              Limit of blank {withUnits(lim.lob.c, u)} (signal {fmt(lim.lob.signal, 4)}), limit of detection {withUnits(lim.lod?.c, u)}, limit of quantitation {withUnits(lim.loq?.c, u)}.
            </p>
            <div className="rp-two">
              <div>
                <p className="rp-cap">Blank against a sample at the detection limit</p>
                <DetectPlot m={m} lim={lim} signalLabel={s.signalLabel || 'Signal'} units={u} width={half} height={210} />
              </div>
              <div>
                <p className="rp-cap">Precision of the reported concentration</p>
                <ProfilePlot m={m} lim={lim} xLabel={concLabel(s)} x1={lim.loq ? Math.min(m.cMax, Math.max(lim.loq.c * 4, (lim.uloq?.c ?? 0) * 1.15)) : m.cMax} width={half} height={210} />
              </div>
            </div>
          </section>
        )}

        {chk.total > 0 && (
          <section className="rp-sec" data-slide>
            <p className="rp-kicker">Requirements</p>
            <h2 className="rp-h">{chk.met === chk.total ? `All ${chk.total} requirements are met.` : `${chk.met} of ${chk.total} requirements are met.`}</h2>
            <div style={{ marginTop: 12 }}>
              {chk.results.map((r, i) => {
                const f = requirementFinding(r, s)
                return (
                  <div className="rp-req" key={i}>
                    {dot(r.ok)}
                    <div>
                      <b>{r.label?.trim() || requirementText(r, s)}</b>
                      {r.label?.trim() ? <span className="rp-muted"> · {requirementText(r, s)}</span> : null}
                      <br />
                      <span className={r.ok ? 'rp-good' : 'rp-bad'}>{f.found}</span>
                      {f.gap && <span className="rp-muted"> · {f.gap}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {read && (
          <section className="rp-sec" data-slide>
            <p className="rp-kicker">Samples</p>
            <h2 className="rp-h">{read.rows.filter((r) => r.flag !== 'invalid').length} readings read back to concentration.</h2>
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Sample</th>
                  <th>{s.signalLabel || 'Signal'}</th>
                  <th>{concLabel(s)}</th>
                  <th>95% range</th>
                  <th>CV</th>
                  <th className="l">Note</th>
                </tr>
              </thead>
              <tbody>
                {read.rows
                  .filter((r) => r.flag !== 'invalid')
                  .map((r, i) => (
                    <tr key={i}>
                      <td>{r.id || i + 1}</td>
                      <td>{fmt(r.signal, 4)}</td>
                      <td>
                        <b>{r.flag === 'below' ? `< ${fmt(read.lod)}` : r.flag === 'above' ? `> ${fmt(m.cMax * r.dilution)}` : fmt(r.result)}</b>
                      </td>
                      <td>{r.resultLo !== null && r.resultHi !== null ? `${fmt(r.resultLo)} – ${fmt(r.resultHi)}` : ''}</td>
                      <td>{r.cv !== null ? pct2(r.cv) : ''}</td>
                      <td className="l rp-muted">{FLAG_TEXT[r.flag]}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="rp-sec">
          <p className="rp-kicker">How this was worked out</p>
          <p className="rp-foot">
            Curve: {source}. Two neighbouring levels count as resolved when {ruleText(s.metric, s.kTarget).replace('·', '(about')} for equal spreads). Limit of blank: blank mean + z·SD with{' '}
            {fmt(s.limits.alpha * 100, 3)}% false positives; limit of detection: {fmt(s.limits.beta * 100, 3)}% false negatives; limit of quantitation: result CV within {fmt(s.limits.cv * 100, 3)}%
            {s.limits.reads > 1 ? `, ${s.limits.reads} strips averaged per result` : ''}. Readings are assumed normally distributed around the curve. Made with Cal Wizard.
          </p>
        </section>
      </div>
    </div>
  )
}
