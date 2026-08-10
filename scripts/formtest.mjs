/**
 * Native-input check of the interactive form-field path (the blue boxes),
 * using the sample that actually has an AcroForm.
 */
import { OUT_DIR } from './outdir.mjs'
import { launchChrome, openPage, sleep } from './cdp.mjs'
import { writeFileSync } from 'node:fs'
import { PDFDocument, PDFName } from 'pdf-lib'

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
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })
  for (let i = 0; i < 100; i++) {
    if (await page.eval(`return !!window.__store`)) break
    await sleep(100)
  }

  await page.eval(`
    const blob = await fetch('/samples/form.pdf').then((r) => r.blob())
    const input = document.querySelector('input[type=file][accept="application/pdf"]')
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'form.pdf', { type: 'application/pdf' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  `)
  for (let i = 0; i < 100; i++) {
    if (await page.eval(`return !!document.querySelector('.page-inner canvas')`)) break
    await sleep(100)
  }
  await sleep(400)

  const fieldCount = await page.eval(`return window.__store.getState().fields.length`)
  check('form fields detected', fieldCount > 0, `${fieldCount} fields`)

  const inputBox = await page.centreOf('.field-input')
  check('a blue field is on screen', !!inputBox, JSON.stringify(inputBox))
  if (!inputBox) throw new Error('no .field-input rendered')

  await page.click(inputBox.x, inputBox.y)
  await page.typeText('Ada Lovelace')
  await sleep(150)
  const values = await page.eval(`return window.__store.getState().formValues`)
  const typed = Object.values(values).some((v) => String(v).includes('Ada Lovelace'))
  check('typing into a blue field works', typed, JSON.stringify(values))

  // Is there anything at all to style it with?
  const controls = await page.eval(`
    return {
      textGroupVisible: !!document.querySelector('.toolbar select'),
      boldButton: !!document.querySelector('[title="Bold"]'),
      inspectorVisible: !!document.querySelector('.inspector'),
      selectedField: window.__store.getState().selectedField,
    }
  `)
  check('a style control exists for the field', controls.textGroupVisible, JSON.stringify(controls))
  check(
    'the field is the styling target',
    !!controls.selectedField,
    `selectedField=${controls.selectedField}`,
  )

  // Style the focused field and confirm it reaches the exported PDF.
  await page.eval(`
    const b = [...document.querySelectorAll('.toolbar button')].find((e) => e.title === 'Bold')
    b.click(); return true
  `)
  await sleep(120)
  await page.eval(`
    const sel = document.querySelector('.toolbar select')
    sel.value = 'times'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  `)
  await sleep(120)
  const styleState = await page.eval(`
    const s = window.__store.getState()
    return { selectedField: s.selectedField, styles: s.fieldStyles }
  `)
  check(
    'styling a field is recorded',
    !!styleState.styles[styleState.selectedField],
    JSON.stringify(styleState),
  )

  const base64 = await page.eval(`
    const st = window.__store.getState()
    const { exportPdf } = await import('/src/pdf/export.ts')
    const bytes = await exportPdf(st.doc.bytes, st.pages, st.annos, st.formValues,
      st.doc.initialFormValues, {}, st.fieldStyles)
    let out = ''
    for (const b of bytes) out += String.fromCharCode(b)
    return btoa(out)
  `)
  const bytes = Buffer.from(base64, 'base64')
  writeFileSync(`${OUT_DIR}/out-form-styled.pdf`, bytes)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const fonts = new Set()
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const base = obj?.get?.(PDFName.of('BaseFont'))
    if (base) fonts.add(String(base))
  }
  check('exported form embeds the chosen font', [...fonts].some((f) => /Times.*Bold/i.test(f)), [...fonts].join(', '))
  const da = doc.getForm().getField(styleState.selectedField).acroField.getDefaultAppearance()
  check('field default appearance updated', /Tf/.test(da ?? ''), JSON.stringify(da))

  // And can the Edit-text tool even reach text under a field?
  await page.eval(`
    const b = [...document.querySelectorAll('.tool')].find((e) => e.title.includes('Edit text') || e.title.includes('existing text'))
    b?.click(); return true
  `)
  await sleep(300)
  const layering = await page.eval(`
    const f = document.querySelector('.field-input')
    if (!f) return { reachable: null }
    const r = f.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { reachable: top?.className ?? String(top?.tagName) }
  `)
  check(
    'blue fields stay clickable with the Edit tool',
    /field-input/.test(String(layering.reachable)),
    `topmost element: ${layering.reachable}`,
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
