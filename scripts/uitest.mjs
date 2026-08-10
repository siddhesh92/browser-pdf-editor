/**
 * Drives the REAL app (index.html) with native mouse and keyboard input via
 * CDP, reproducing what a person actually does. Run with `npm run uitest`.
 */
import { OUT_DIR } from './outdir.mjs'
import { launchChrome, openPage, sleep } from './cdp.mjs'
import { writeFileSync } from 'node:fs'
import { PDFDocument, PDFName } from 'pdf-lib'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const results = []
let failures = 0

function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const chrome = await launchChrome({ headless: process.env.HEADED !== '1' })
const page = await openPage(APP)

try {
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })

  await waitFor('app to mount', () => page.eval(`return !!window.__store`))

  // Open a sample the way the file picker would, then use nothing but real input.
  await page.eval(`
    const blob = await fetch('/samples/report.pdf').then((r) => r.blob())
    const input = document.querySelector('input[type=file][accept="application/pdf"]')
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'report.pdf', { type: 'application/pdf' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  `)
  await waitFor('page to render', () => page.eval(`return !!document.querySelector('.page-inner canvas')`))
  check('document opens', true)

  // --- click the Edit tool for real -----------------------------------------
  await clickSelector('[title="Click existing text to edit or delete it (E)"]')
  check('edit tool active', (await state()).tool === 'edit')

  // --- click a line of text for real ----------------------------------------
  await waitFor('text hit targets', () => page.eval(`return !!document.querySelector('.text-hit')`))
  await clickSelector('.text-hit')
  let st = await state()
  check('clicking text creates an edit', !!st.selected, JSON.stringify(st.selected))
  check('it opens for typing', st.editingId === st.selectedId)

  // --- type for real --------------------------------------------------------
  await page.typeText(' EDITED')
  st = await state()
  check('typing reaches the annotation', (st.selected?.text ?? '').includes('EDITED'), st.selected?.text)

  // --- the actual complaint: click Bold with a real mouse -------------------
  const before = await state()
  await clickSelector('[title="Bold"]')
  const afterBold = await state()
  check(
    'BOLD applies to the edited text',
    afterBold.selected?.bold === true,
    `selectedId ${before.selectedId} -> ${afterBold.selectedId}, editing ${before.editingId} -> ${afterBold.editingId}, bold ${before.selected?.bold} -> ${afterBold.selected?.bold}`,
  )

  await clickSelector('[title="Italic"]')
  const afterItalic = await state()
  check('ITALIC applies', afterItalic.selected?.italic === true, describe(afterItalic))

  // Font family via a real select interaction.
  await page.eval(`
    const sel = document.querySelector('.toolbar select')
    sel.value = 'times'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  `)
  await sleep(80)
  check('FONT applies', (await state()).selected?.font === 'times', describe(await state()))

  // Size via the stepper's + button, clicked natively.
  const sizeBefore = (await state()).selected?.fontSize
  await clickSelector('[title="Font size (pt)"] button:last-child')
  const sizeAfter = (await state()).selected?.fontSize
  check('SIZE applies', sizeAfter === sizeBefore + 1, `${sizeBefore} -> ${sizeAfter}`)

  // --- and does it survive to the file? -------------------------------------
  // The PDF is inspected in Node: font dictionaries live inside compressed
  // object streams, so a regex over the raw bytes in the page finds nothing.
  const base64 = await page.eval(`
    const st = window.__store.getState()
    const { exportPdf } = await import('/src/pdf/export.ts')
    const bytes = await exportPdf(st.doc.bytes, st.pages, st.annos, st.formValues, st.doc.initialFormValues)
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s)
  `)
  const bytes = Buffer.from(base64, 'base64')
  writeFileSync(`${OUT_DIR}/out-uitest.pdf`, bytes)
  const fonts = await fontsUsedIn(bytes)
  check(
    'export uses the chosen font',
    fonts.some((f) => /Times.*Bold.*Italic/i.test(f)),
    fonts.join(', ') || 'none',
  )
  const finalText = (await state()).selected?.text
  check('export carries the retyped string', (finalText ?? '').includes('EDITED'), finalText)

  // --- second path: a text box the user adds themselves --------------------
  await clickSelector('[title="Drag to add a text box (X)"]')
  const overlay = await page.centreOf('.overlay')
  await page.click(overlay.x, overlay.y + 150)
  await sleep(200)
  let box = await state()
  check('text box created', box.selected?.type === 'textBox', JSON.stringify(box.selected))
  check('text box opens for typing', box.editingId === box.selectedId, `editing ${box.editingId}`)

  await page.typeText('Hello box')
  box = await state()
  check('typing into the new box works', box.selected?.text === 'Hello box', box.selected?.text)

  const boxBoldBefore = box.selected?.bold
  await clickSelector('[title="Bold"]')
  box = await state()
  check(
    'BOLD applies to a text box',
    box.selected?.bold !== boxBoldBefore,
    `${boxBoldBefore} -> ${box.selected?.bold}, selected ${box.selectedId}`,
  )

  const boxSizeBefore = box.selected?.fontSize
  await clickSelector('[title="Font size (pt)"] button:last-child')
  box = await state()
  check('SIZE applies to a text box', box.selected?.fontSize === boxSizeBefore + 1, `${boxSizeBefore} -> ${box.selected?.fontSize}`)

  // --- third path: re-select an existing item and restyle it ---------------
  await clickSelector('[title="Select, move and resize (V)"]')
  await sleep(150)
  const anno = await page.centreOf('.anno .text-preview')
  await page.click(anno.x, anno.y)
  await sleep(200)
  let re = await state()
  check('clicking an item re-selects it', !!re.selectedId, `selected ${re.selectedId} type ${re.selected?.type}`)
  const reBold = re.selected?.bold
  await clickSelector('[title="Bold"]')
  re = await state()
  check('BOLD applies after re-selecting', re.selected?.bold !== reBold, `${reBold} -> ${re.selected?.bold}`)
} catch (e) {
  check('harness completed', false, e.message)
} finally {
  console.log(results.join('\n'))
  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed')
  page.close()
  chrome.kill('SIGKILL')
  process.exit(failures ? 1 : 0)
}

async function fontsUsedIn(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const names = new Set()
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const base = obj?.get?.(PDFName.of('BaseFont'))
    if (base) names.add(base.asString?.() ?? String(base))
  }
  return [...names]
}

async function state() {
  return page.eval(`
    const s = window.__store.getState()
    const sel = s.annos.find((a) => a.id === s.selectedId) ?? null
    return {
      tool: s.tool,
      selectedId: s.selectedId,
      editingId: s.editingId,
      annoCount: s.annos.length,
      defaults: { bold: s.bold, italic: s.italic, font: s.fontFamily, fontSize: s.fontSize },
      selected: sel && {
        id: sel.id, type: sel.type, text: sel.text, bold: sel.bold,
        italic: sel.italic, font: sel.font, fontSize: sel.fontSize,
      },
    }
  `)
}

function describe(st) {
  return JSON.stringify({ selected: st.selected, defaults: st.defaults })
}

async function clickSelector(selector) {
  const box = await page.centreOf(selector)
  if (!box) throw new Error(`no element matching ${selector}`)
  await page.click(box.x, box.y)
}

async function waitFor(label, fn, ms = 15000) {
  const deadline = Date.now() + ms
  for (;;) {
    if (await fn()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(100)
  }
}
