/**
 * Runs the UI self-test in headless Chrome and prints its results.
 *
 * Chrome's --virtual-time-budget stalls the pdf.js worker, so instead of
 * dumping the DOM we let the page run on real timers and POST its results back
 * to a throwaway server here.
 */
import { OUT_DIR } from './outdir.mjs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP = process.env.APP_URL ?? 'http://localhost:5173'
const SINK_PORT = 5199
const TIMEOUT_MS = 90_000

let settled = false
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    res.writeHead(204).end()
    finish(body)
  })
})

async function finish(body) {
  if (settled) return
  settled = true
  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    payload = { failures: 1, lines: [`unparseable result: ${body.slice(0, 400)}`] }
  }
  console.log(payload.lines.join('\n'))
  if (payload.exported) await inspectExport(payload.exported)
  console.log(payload.failures ? `\n${payload.failures} failure(s)` : '\nAll UI checks passed')
  cleanup(payload.failures ? 1 : 0)
}

/**
 * The browser's export is inspected here rather than in the page: pdf-lib can
 * see inside object streams, so font names are readable even when compressed.
 */
async function inspectExport(base64) {
  const bytes = Buffer.from(base64, 'base64')
  writeFileSync(`${OUT_DIR}/out-ui.pdf`, bytes)
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const fonts = new Set()
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const base = obj?.get?.(doc.context.obj('BaseFont').constructor.of?.('BaseFont'))
      if (base) fonts.add(String(base))
    }
    const raw = bytes.toString('latin1')
    for (const m of raw.matchAll(/\/BaseFont\s*\/([\w+-]+)/g)) fonts.add(m[1])
    console.log(`  export: ${bytes.length} bytes, fonts: ${[...fonts].join(', ') || 'NONE'}`)
    console.log(`  literal 'Rewritten heading' present: ${raw.includes('Rewritten heading')}`)
    console.log(`  wrote ${OUT_DIR}/out-ui.pdf`)
  } catch (e) {
    console.log(`  export could not be parsed: ${e.message}`)
  }
}

function cleanup(code) {
  chrome?.kill('SIGKILL')
  server.close()
  process.exit(code)
}

server.listen(SINK_PORT)

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--disable-extensions',
  `--user-data-dir=${OUT_DIR}/chrome-selftest`,
  `${APP}/selftest.html?sink=${SINK_PORT}`,
])
chrome.on('error', (e) => {
  console.error(`could not launch Chrome: ${e.message}`)
  cleanup(1)
})

setTimeout(() => {
  console.error('self-test timed out with no result posted')
  cleanup(1)
}, TIMEOUT_MS)
