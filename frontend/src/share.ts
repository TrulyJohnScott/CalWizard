/**
 * Sharing (spec §21): the whole series travels inside the link (`#s=...`, deflated JSON, nothing is uploaded), and
 * the report can be saved as one self-contained HTML file.
 */
import { toWire } from './api'
import type { Series } from './math/types'

const b64url = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64url = (t: string) => {
  const s = atob(t.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const w = stream.writable.getWriter()
  void w.write(bytes as unknown as Uint8Array<ArrayBuffer>)
  void w.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

/** Series -> the text after `#s=`: "z" + deflated, or "j" + plain when the browser cannot compress. */
export async function encodeShare(s: Series & { id?: string }): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(toWire(s)))
  try {
    return `z${b64url(await pipe(bytes, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>))}`
  } catch {
    return `j${b64url(bytes)}`
  }
}

/** The inverse; null when the text is not a share payload. The result is untrusted JSON: sanitise it. */
export async function decodeShare(text: string): Promise<unknown | null> {
  try {
    const body = unb64url(text.slice(1))
    const bytes = text[0] === 'z' ? await pipe(body, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>) : text[0] === 'j' ? body : null
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null
  } catch {
    return null
  }
}

export async function shareUrl(s: Series): Promise<string> {
  const base = `${location.origin}${location.pathname}`
  return `${base}#s=${await encodeShare(s)}`
}

/** `#s=...` in the address bar, if any. */
export const shareFromHash = (hash: string): string | null => /[#&]s=([A-Za-z0-9_-]+)/.exec(hash)?.[1] ?? null

/** A complete HTML document around the rendered report; the series JSON rides along so the file can be reopened. */
export function reportDocument(title: string, bodyHtml: string, css: string, s: Series, link: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const json = JSON.stringify(toWire(s)).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>html,body{margin:0;background:#fff}${css}
.rp-open{display:block;max-width:920px;margin:0 auto;padding:0 36px 40px;font:12px system-ui,sans-serif;color:#6b6b76}
.rp-open a{color:#4c5bd4}
@media print{.rp-open{display:none}}</style>
</head>
<body>
${bodyHtml}
<p class="rp-open"><a href="${esc(link)}">Open this assay in Cal Wizard</a> to explore it.</p>
<script type="application/json" id="calwizard-series">${json}</script>
</body>
</html>
`
}

/** The series embedded in a saved report file (so dropping the HTML onto the app reloads it). */
export function seriesFromReport(html: string): unknown | null {
  const m = /<script type="application\/json" id="calwizard-series">([\s\S]*?)<\/script>/.exec(html)
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}
