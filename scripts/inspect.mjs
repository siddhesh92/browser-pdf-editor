/**
 * Load a real PDF into the running app and report what it renders versus what
 * the file actually says. Use this before theorising about a form-field bug.
 *
 *   node scripts/inspect.mjs "/path/to/form.pdf" [fieldNameToZoomTo]
 *
 * The file is copied into public/ only for the duration of the run.
 */
import { OUT_DIR } from './outdir.mjs'
import { launchChrome, openPage, sleep } from './cdp.mjs'
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'

const source = process.argv[2]
const zoomTo = process.argv[3]
if (!source) {
  console.error('usage: node scripts/inspect.mjs <pdf> [fieldName]')
  process.exit(1)
}

const served = 'public/__inspect.pdf'
copyFileSync(source, served)

// What the file itself says, independent of the app.
const doc = await PDFDocument.load(new Uint8Array(readFileSync(source)), { ignoreEncryption: true })
const fileOn = []
for (const f of doc.getForm().getFields()) {
  if (f.constructor.name !== 'PDFCheckBox' && f.constructor.name !== 'PDFRadioGroup') continue
  for (const w of f.acroField.getWidgets()) {
    const on = w.getOnValue()
    if (on && w.getAppearanceState() === on) fileOn.push(f.getName())
  }
}

const chrome = await launchChrome({ headless: true })
const page = await openPage(process.env.APP_URL ?? 'http://localhost:5173')
try {
  await page.send('Page.enable')
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  })
  for (let i = 0; i < 100; i++) {
    if (await page.eval(`return !!window.__store`)) break
    await sleep(100)
  }
  await page.eval(`
    const blob = await fetch('/__inspect.pdf').then((r) => r.blob())
    const input = document.querySelector('input[type=file][accept="application/pdf"]')
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'inspect.pdf', { type: 'application/pdf' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  `)
  for (let i = 0; i < 300; i++) {
    if (await page.eval(`return !!document.querySelector('.page-inner canvas')`)) break
    await sleep(100)
  }
  await sleep(2500)

  const seen = await page.eval(`
    const s = window.__store.getState()
    return {
      status: s.status,
      boxes: document.querySelectorAll('.field-toggle, .field-radio').length,
      ticked: [...document.querySelectorAll('.field-toggle.on, .field-radio.on')].map(e => e.title),
      covering: document.querySelectorAll('.covering').length,
      smallest: Math.min(...s.fields.flatMap(f => f.widgets.map(w => w.rect.h))).toFixed(1),
    }
  `)

  console.log('file says ON   :', fileOn.length, fileOn.join(', ') || '(none)')
  console.log('app renders ON :', seen.ticked.length, seen.ticked.join(', ') || '(none)')
  console.log('boxes drawn    :', seen.boxes, '| covering:', seen.covering,
    '| smallest widget:', seen.smallest + 'pt')
  console.log('status         :', seen.status)
  const match =
    seen.ticked.length === fileOn.length && fileOn.every((n) => seen.ticked.includes(n))
  console.log(match ? '\nMATCH — the app agrees with the file' : '\nMISMATCH')

  if (zoomTo) {
    const clip = await page.eval(`
      const s = window.__store.getState()
      const f = s.fields.find(x => x.name === ${JSON.stringify(zoomTo)})
      if (!f) return null
      const w = f.widgets[0]
      const el = document.querySelectorAll('.page-inner')[w.page]
      const b = el.getBoundingClientRect()
      window.scrollTo(0, window.scrollY + b.top + w.rect.y * s.zoom - 120)
      return true
    `)
    if (clip) {
      await sleep(600)
      const box = await page.eval(`
        const s = window.__store.getState()
        const f = s.fields.find(x => x.name === ${JSON.stringify(zoomTo)})
        const w = f.widgets[0]
        const el = document.querySelectorAll('.page-inner')[w.page]
        const b = el.getBoundingClientRect()
        return { x: b.left + w.rect.x * s.zoom - 10, y: b.top + w.rect.y * s.zoom - 10 }
      `)
      const shot = await page.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: box.x, y: box.y, width: 240, height: 150, scale: 6 },
      })
      writeFileSync(`${OUT_DIR}/shot-inspect.png`, Buffer.from(shot.data, 'base64'))
      console.log(`wrote ${OUT_DIR}/shot-inspect.png`)
    }
  }
} finally {
  page.close()
  chrome.kill('SIGKILL')
  rmSync(served, { force: true })
}
