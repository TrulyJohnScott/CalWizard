/** The exported report (spec §20, §21): one self-contained HTML document carrying the claims and the series. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Report, REPORT_CSS } from './components/Report'
import { EXAMPLES } from './examples'
import { defaultSeries } from './math/presets'
import { reportDocument, seriesFromReport } from './share'
import { deriveStatic } from './state/derived'
import { sanitizeSeries } from './state/store'

describe('report export', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s renders to a standalone document with its claims', (_, ex) => {
    const s = sanitizeSeries({ ...defaultSeries(), ...ex.series })
    const d = deriveStatic(s)
    const pair = d.model.levels.length > 2 ? { a: d.model.levels[1], b: d.model.levels[2] } : null
    const body = renderToStaticMarkup(createElement(Report, { d, opt: { static: true, pair, date: 'today' } }))
    const html = reportDocument(s.name, body, REPORT_CSS, s, 'http://localhost/#s=x')
    expect(body).toContain(s.name)
    expect(body).toContain(`<b>${d.resolvable.length}</b>`) // the headline count is in the page
    expect(body.match(/<svg/g)!.length).toBeGreaterThanOrEqual(3) // curve, detection, precision (and the pair)
    expect(html).not.toMatch(/<script src|<link |https?:\/\/(?!localhost)/) // nothing fetched from anywhere
    expect(body).not.toMatch(/NaN|undefined|Infinity/)
    if (s.requirements.length) expect(body).toContain(`${d.requirements.met} of ${d.requirements.total}`)
    expect(sanitizeSeries(seriesFromReport(html))).toEqual(s)
  })
})
