/**
 * Drives the real UI with real DOM events in headless Chrome, so interaction
 * bugs (which the Node-side export checks cannot see) get caught.
 * Served at /selftest.html by the dev server; run via `npm run selftest`.
 */
import { createRoot } from 'react-dom/client'
import App from './App'
import { useDoc } from './store/document'
import { isTextual } from './types'
import { exportPdf } from './pdf/export'
import './index.css'

const out: string[] = []
let failures = 0

function check(name: string, ok: boolean, detail = '') {
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
  flush()
}

function flush() {
  const el = document.getElementById('result')
  if (el) el.textContent = out.join('\n') + (failures ? `\n\n${failures} failure(s)` : '')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor<T>(label: string, fn: () => T | null | undefined, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(50)
  }
}

function byTitle(title: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[title="${title}"]`)
}

function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

/** Click and let React re-render, the way any real click has time to. */
async function clickAndSettle(el: Element) {
  click(el)
  await sleep(80)
}

function pointerDown(el: Element, x = 0, y = 0) {
  el.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  )
}

/** React tracks input value on the DOM node, so bypass its setter to type. */
function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

let exported = ''
const errors: string[] = []
window.addEventListener('error', (e) => errors.push(`window.error: ${e.message}`))
window.addEventListener('unhandledrejection', (e) =>
  errors.push(`unhandled: ${String((e as PromiseRejectionEvent).reason)}`),
)

async function main() {
  // Synthetic pointer events carry no real capture target.
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}

  createRoot(document.getElementById('root')!).render(<App />)
  await sleep(100)

  // --- open a document -----------------------------------------------------
  const blob = await fetch('/samples/report.pdf').then((r) => r.blob())
  const file = new File([blob], 'report.pdf', { type: 'application/pdf' })
  const input = await waitFor('file input', () =>
    document.querySelector<HTMLInputElement>('input[type="file"][accept="application/pdf"]'),
  )
  const dt = new DataTransfer()
  dt.items.add(file)
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))

  await waitFor('page canvas', () => document.querySelector('.page-inner canvas'))
  check('document opens', useDoc.getState().pages.length === 1)

  // --- edit existing text --------------------------------------------------
  await clickAndSettle(
    await waitFor('edit tool', () => byTitle('Click existing text to edit or delete it (E)')),
  )
  check('edit tool active', useDoc.getState().tool === 'edit')

  const hit = await waitFor('text hit target', () => document.querySelector('.text-hit'))
  pointerDown(hit)
  await sleep(120)

  const state1 = useDoc.getState()
  const edited = state1.annos.find((a) => a.type === 'textEdit')
  check('clicking text creates an edit', !!edited, edited ? `"${edited.text.slice(0, 30)}"` : '')
  check('it opens for typing', state1.editingId === edited?.id)

  const ta = await waitFor('textarea', () =>
    document.querySelector<HTMLTextAreaElement>('.anno textarea'),
  )
  typeInto(ta, 'Rewritten heading')
  await sleep(60)
  const typed = useDoc.getState().annos.find((a) => a.id === edited?.id)
  check(
    'typing updates the annotation',
    !!typed && isTextual(typed) && typed.text === 'Rewritten heading',
  )

  // --- style controls while the text is focused ----------------------------
  const boldBtn = byTitle('Bold')
  check('bold button is present', !!boldBtn)
  if (boldBtn) {
    // Mirror a real click: focus leaves the textarea first, then the click lands.
    // React listens for focusout, not the non-bubbling blur event.
    ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await sleep(30)
    click(boldBtn)
    await sleep(60)
    const a = useDoc.getState().annos.find((x) => x.id === edited?.id)
    check('bold applies to the selected text', !!a && isTextual(a) && a.bold === true, describe(a))
  }

  const fontSel = document.querySelector<HTMLSelectElement>('.toolbar select')
  check('font select is present', !!fontSel)
  if (fontSel) {
    fontSel.value = 'times'
    fontSel.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(60)
    const a = useDoc.getState().annos.find((x) => x.id === edited?.id)
    check('font applies to the selected text', !!a && isTextual(a) && a.font === 'times', describe(a))
  }

  const sizeInput = document.querySelector<HTMLInputElement>(
    '[title="Font size (pt)"] input',
  )
  check('size stepper is present', !!sizeInput)
  if (sizeInput) {
    typeInto(sizeInput, '28')
    await sleep(60)
    const a = useDoc.getState().annos.find((x) => x.id === edited?.id)
    check('size applies to the selected text', !!a && isTextual(a) && a.fontSize === 28, describe(a))
  }

  const italicBtn = byTitle('Italic')
  if (italicBtn) {
    click(italicBtn)
    await sleep(60)
    const a = useDoc.getState().annos.find((x) => x.id === edited?.id)
    check('italic applies to the selected text', !!a && isTextual(a) && a.italic === true, describe(a))
  }

  // --- the styling must reach the screen and the file, not just the store ---
  const preview = document.querySelector<HTMLElement>('.anno .text-preview')
  check('styled text renders as a preview', !!preview)
  if (preview) {
    const cs = getComputedStyle(preview)
    check(
      'preview reflects the style',
      cs.fontWeight === '700' &&
        cs.fontStyle === 'italic' &&
        /Times/i.test(cs.fontFamily) &&
        Math.round(parseFloat(cs.fontSize)) === Math.round(28 * useDoc.getState().zoom),
      `${cs.fontFamily} ${cs.fontWeight} ${cs.fontStyle} ${cs.fontSize}`,
    )
  }

  {
    const st = useDoc.getState()
    const bytes = await exportPdf(
      st.doc!.bytes,
      st.pages,
      st.annos,
      st.formValues,
      st.doc!.initialFormValues,
    )
    check('export produced bytes', bytes.length > 0, `${bytes.length} bytes`)
    exported = btoa(String.fromCharCode(...bytes))
  }

  // --- a new text box ------------------------------------------------------
  await clickAndSettle(await waitFor('text tool', () => byTitle('Drag to add a text box (X)')))
  const overlay = document.querySelector('.overlay')!
  const box = overlay.getBoundingClientRect()
  pointerDown(overlay, box.left + 60, box.top + 400)
  overlay.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 1,
      clientX: box.left + 60,
      clientY: box.top + 400,
    }),
  )
  await sleep(120)
  const tb = useDoc.getState().annos.find((a) => a.type === 'textBox')
  check('text tool creates a box', !!tb)
  check('new box inherits the current style', !!tb && tb.font === 'times' && tb.bold === true, describe(tb))

  // --- marks ---------------------------------------------------------------
  await clickAndSettle(await waitFor('tick tool', () => byTitle('Click to place a tick (C)')))
  const markSize = document.querySelector<HTMLInputElement>('[title="Mark size (pt)"] input')
  check('mark size control is present', !!markSize)
  if (markSize) {
    typeInto(markSize, '5')
    await sleep(60)
    check('mark size default updates', useDoc.getState().markSize === 5)
  }
  pointerDown(overlay, box.left + 100, box.top + 500)
  await sleep(80)
  const mark = useDoc.getState().annos.find((a) => a.type === 'check')
  check('tick is placed at the chosen size', !!mark && Math.round(mark.rect.w) === 5, describe(mark))

  if (markSize) {
    typeInto(markSize, '3')
    await sleep(60)
    const m = useDoc.getState().annos.find((a) => a.type === 'check')
    check('resizing the selected tick works', !!m && Math.round(m.rect.w) === 3, describe(m))
  }

  report()
}

/** Hand the results to scripts/selftest-runner.mjs. */
function report() {
  flush()
  const sink = new URLSearchParams(location.search).get('sink')
  if (!sink) return
  void fetch(`http://localhost:${sink}/result`, {
    method: 'POST',
    body: JSON.stringify({
      failures,
      lines: [...out, ...errors.map((e) => `  ${e}`)],
      exported,
    }),
  })
}

function describe(a: unknown): string {
  if (!a || typeof a !== 'object') return String(a)
  const o = a as Record<string, unknown>
  return JSON.stringify({
    type: o.type,
    font: o.font,
    bold: o.bold,
    italic: o.italic,
    fontSize: o.fontSize,
    w: typeof o.rect === 'object' ? (o.rect as { w: number }).w : undefined,
  })
}

main().catch((e) => {
  out.push(`ERROR ${e instanceof Error ? e.message : String(e)}`)
  out.push(`store.status: ${useDoc.getState().status}`)
  out.push(`pages: ${useDoc.getState().pages.length}, doc: ${!!useDoc.getState().doc}`)
  out.push(...errors.map((x) => `  ${x}`))
  failures++
  flush()
  document.title = 'SELFTEST FAIL'
})
