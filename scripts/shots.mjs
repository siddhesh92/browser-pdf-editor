/**
 * Screenshots the real app through the text-editing flow, so what the harness
 * sees can be compared against what a person sees. `node scripts/shots.mjs`
 */
import { OUT_DIR } from './outdir.mjs'
import { launchChrome, openPage, sleep } from './cdp.mjs'
import { writeFileSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = OUT_DIR

const chrome = await launchChrome({ headless: true })
const page = await openPage(APP)

async function shot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${DIR}/shot-${name}.png`, Buffer.from(data, 'base64'))
  console.log(`wrote shot-${name}.png`)
}

async function clickSelector(selector) {
  const box = await page.centreOf(selector)
  if (!box) throw new Error(`no element matching ${selector}`)
  await page.click(box.x, box.y)
}

try {
  await page.send('Page.enable')
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 950,
    deviceScaleFactor: 2,
    mobile: false,
  })
  for (let i = 0; i < 100; i++) {
    if (await page.eval(`return !!window.__store`)) break
    await sleep(100)
  }

  await page.eval(`
    const blob = await fetch('/samples/report.pdf').then((r) => r.blob())
    const input = document.querySelector('input[type=file][accept="application/pdf"]')
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'report.pdf', { type: 'application/pdf' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  `)
  for (let i = 0; i < 100; i++) {
    if (await page.eval(`return !!document.querySelector('.page-inner canvas')`)) break
    await sleep(100)
  }
  await sleep(400)

  await clickSelector('[title="Click existing text to edit or delete it (E)"]')
  await sleep(400)
  await shot('1-edit-tool')

  await clickSelector('.text-hit')
  await sleep(300)
  await page.typeText(' EDITED')
  await sleep(200)
  await shot('2-typed')

  await clickSelector('[title="Bold"]')
  await sleep(200)
  await clickSelector('[title="Font size (pt)"] button:last-child')
  await sleep(300)
  await shot('3-bold-and-bigger')

  console.log(JSON.stringify(await page.eval(`
    const s = window.__store.getState()
    const sel = s.annos.find((a) => a.id === s.selectedId)
    return { tool: s.tool, editingId: s.editingId, selected: sel && {
      type: sel.type, text: sel.text, bold: sel.bold, font: sel.font, fontSize: sel.fontSize } }
  `)))
} finally {
  page.close()
  chrome.kill('SIGKILL')
}
