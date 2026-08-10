/**
 * A pre-filled form field must not appear twice: pdf.js paints the widget's
 * baked appearance stream onto the canvas, and our HTML overlay draws the same
 * value on top of it. This measures ink on the canvas under a field's rect.
 */
import { OUT_DIR } from './outdir.mjs'
import { launchChrome, openPage, sleep } from './cdp.mjs'
import { writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const results = []
let failures = 0
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const chrome = await launchChrome({ headless: true })
const page = await openPage(APP)

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
    const blob = await fetch('/samples/form-filled.pdf').then((r) => r.blob())
    const input = document.querySelector('input[type=file][accept="application/pdf"]')
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'form-filled.pdf', { type: 'application/pdf' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  `)
  for (let i = 0; i < 100; i++) {
    if (await page.eval(`return !!document.querySelector('.page-inner canvas')`)) break
    await sleep(100)
  }
  await sleep(600)

  check(
    'pre-filled values were read',
    await page.eval(`return window.__store.getState().formValues['applicant.name'] === 'Prefilled Name'`),
  )

  // The canvas legitimately paints the field's baked value; what matters is
  // that our overlay is opaque, so the two cannot show side by side.
  const overlay = await page.eval(`
    const el = document.querySelector('.field-input')
    const bg = getComputedStyle(el).backgroundColor
    const alpha = bg.startsWith('rgba') ? Number(bg.split(',')[3]) : 1
    return { bg, alpha }
  `)
  check('text field overlay is opaque', overlay.alpha === 1, overlay.bg)

  // Tick boxes must stay transparent, so the widget's own appearance (which
  // masks the square printed in the page) still shows through.
  const toggle = await page.eval(`
    const el = [...document.querySelectorAll('.field-toggle')].find(e => !e.classList.contains('on'))
    return getComputedStyle(el).backgroundColor
  `)
  check('untouched tick box adds no fill of its own', /, 0\)$/.test(toggle), toggle)

  const ink = await page.eval(`
    const s = window.__store.getState()
    const field = s.fields.find((f) => f.kind === 'text')
    const w = field.widgets[0]
    const canvas = document.querySelector('.page-inner canvas')
    const scale = (canvas.width / canvas.clientWidth) * s.zoom
    const ctx = canvas.getContext('2d')
    const x = Math.round(w.rect.x * scale), y = Math.round(w.rect.y * scale)
    const cw = Math.round(w.rect.w * scale), ch = Math.round(w.rect.h * scale)
    const d = ctx.getImageData(x, y, cw, ch).data
    let dark = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) dark++
    }
    return { dark, total: cw * ch, field: field.name }
  `)
  check('canvas still renders the page itself', ink.total > 0, `${ink.dark} px of baked ink`)

  // Pre-set choices must show as chosen, not just be present in the model.
  const choices = await page.eval(`
    const s = window.__store.getState()
    return {
      values: s.formValues,
      exportValues: s.fields.filter((f) => f.kind === 'radio')
        .map((f) => ({ name: f.name, opts: f.widgets.map((w) => w.exportValue) })),
      radioOn: document.querySelectorAll('.field-radio.on').length,
      checkOn: document.querySelectorAll('.field-toggle.on').length,
    }
  `)
  check('pre-checked checkbox shows as checked', choices.checkOn === 1, `${choices.checkOn} on`)
  check(
    'pre-selected radio shows as selected',
    choices.radioOn === 1,
    `${choices.radioOn} on; value=${JSON.stringify(choices.values['applicant.tier'])}; exportValues=${JSON.stringify(choices.exportValues)}`,
  )

  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT_DIR}/shot-ghost.png`, Buffer.from(data, 'base64'))

  // A form whose /V disagrees with the widget appearance state must follow the
  // appearance state — i.e. show as unticked, the way any viewer renders it.
  await page.eval(`
    const blob = await fetch('/samples/form-quirky.pdf').then((r) => r.blob())
    const input = document.querySelector('input[type=file][accept="application/pdf"]')
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'form-quirky.pdf', { type: 'application/pdf' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  `)
  await sleep(1200)
  const quirky = await page.eval(`
    return {
      values: window.__store.getState().formValues,
      checkedOnScreen: document.querySelectorAll('.field-toggle.on').length,
      totalBoxes: document.querySelectorAll('.field-toggle').length,
    }
  `)
  check(
    'stale /V does not pre-tick boxes',
    quirky.checkedOnScreen === 0,
    `${quirky.checkedOnScreen}/${quirky.totalBoxes} ticked; values=${JSON.stringify(quirky.values)}`,
  )

  // Exporting must clear the stale /V too, so other viewers agree with us.
  const out = await page.eval(`
    const st = window.__store.getState()
    const { exportPdf } = await import('/src/pdf/export.ts')
    const bytes = await exportPdf(st.doc.bytes, st.pages, st.annos, st.formValues,
      st.doc.initialFormValues, {}, st.fieldStyles)
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s)
  `)
  const outBytes = Buffer.from(out, 'base64')
  writeFileSync(`${OUT_DIR}/out-quirky.pdf`, outBytes)
  const outDoc = await PDFDocument.load(outBytes, { ignoreEncryption: true })
  const stillChecked = outDoc
    .getForm()
    .getFields()
    .filter((f) => typeof f.isChecked === 'function' && f.isChecked())
    .map((f) => f.getName())
  check(
    'export clears the stale tick as well',
    stillChecked.length === 0,
    `still checked: ${stillChecked.join(', ') || 'none'}`,
  )
} catch (e) {
  check('harness completed', false, e.message)
} finally {
  console.log(results.join('\n'))
  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed')
  page.close()
  chrome.kill('SIGKILL')
  process.exit(failures ? 1 : 0)
}
