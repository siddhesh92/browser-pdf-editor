/**
 * Headless end-to-end check of the export writer: build annotations of every
 * type against real page geometry, write a PDF, then read it back and assert
 * the form values and page count survived. Run with `npm run verify`.
 */
import { PDFDocument, PDFCheckBox, PDFRadioGroup, PDFTextField } from 'pdf-lib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { exportPdf } from '../src/pdf/export'
import { invert, type Matrix } from '../src/pdf/coords'
import type { Anno, PageInfo } from '../src/types'

const OUT = 'public/samples'
const OUT_DIR = process.env.OUT_DIR ?? 'tmp'
mkdirSync(OUT_DIR, { recursive: true })
const results: string[] = []
let failures = 0

function check(name: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/** Mirrors pdf.js's getViewport({scale:1}) so tests use the real geometry. */
function viewportFor(width: number, height: number, rotation: number): PageInfo['transform'] {
  const [a, b, c, d] =
    rotation === 90
      ? [0, 1, 1, 0]
      : rotation === 180
        ? [-1, 0, 0, 1]
        : rotation === 270
          ? [0, -1, -1, 0]
          : [1, 0, 0, -1]
  const cx = width / 2
  const cy = height / 2
  const offX = a === 0 ? cy : cx
  const offY = a === 0 ? cx : cy
  return [a, b, c, d, offX - a * cx - c * cy, offY - b * cx - d * cy]
}

async function pagesOf(bytes: Uint8Array): Promise<PageInfo[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return doc.getPages().map((p, i) => {
    const rotation = ((p.getRotation().angle % 360) + 360) % 360
    const size = p.getSize()
    const transform = viewportFor(size.width, size.height, rotation)
    const swapped = rotation === 90 || rotation === 270
    return {
      index: i,
      width: swapped ? size.height : size.width,
      height: swapped ? size.width : size.height,
      rotation,
      transform,
      inverse: invert(transform as Matrix),
    }
  })
}

const rgbBlue = { r: 0.1, g: 0.35, b: 0.9 }
const rgbBlack = { r: 0, g: 0, b: 0 }
const rgbWhite = { r: 1, g: 1, b: 1 }

function allAnnoTypes(page: number): Anno[] {
  return [
    {
      id: 'a1',
      type: 'textEdit',
      page,
      rect: { x: 72, y: 130, w: 200, h: 12 },
      original: 'Quarterly Report',
      text: 'Annual Report — revised',
      fontSize: 12,
      baselineSize: 12,
      color: rgbBlack,
      bgColor: rgbWhite,
      font: 'times',
      bold: true,
      italic: false,
    },
    {
      id: 'a2',
      type: 'textBox',
      page,
      rect: { x: 60, y: 300, w: 220, h: 60 },
      text: 'A long sentence that must wrap onto several lines inside its box.\nAnd an explicit newline.',
      fontSize: 11,
      color: rgbBlue,
      align: 'center',
      border: true,
      bg: rgbWhite,
      font: 'courier',
      bold: false,
      italic: true,
    },
    { id: 'a3', type: 'check', page, rect: { x: 60, y: 400, w: 16, h: 16 }, color: rgbBlue, width: 2 },
    { id: 'a4', type: 'cross', page, rect: { x: 90, y: 400, w: 16, h: 16 }, color: rgbBlue, width: 2 },
    { id: 'a5', type: 'dot', page, rect: { x: 120, y: 400, w: 16, h: 16 }, color: rgbBlue, width: 2 },
    {
      id: 'a6',
      type: 'ink',
      page,
      rect: { x: 60, y: 440, w: 120, h: 40 },
      paths: [[{ x: 0, y: 1 }, { x: 0.3, y: 0 }, { x: 0.6, y: 1 }, { x: 1, y: 0.2 }]],
      color: rgbBlack,
      width: 2,
    },
    { id: 'a7', type: 'rect', page, rect: { x: 300, y: 400, w: 90, h: 40 }, color: rgbBlue, width: 2, fill: null },
    { id: 'a8', type: 'line', page, rect: { x: 300, y: 460, w: 90, h: 30 }, color: rgbBlack, width: 1, fill: null, flipped: true },
    { id: 'a9', type: 'highlight', page, rect: { x: 60, y: 500, w: 180, h: 14 }, color: { r: 1, g: 0.9, b: 0.2 } },
  ]
}

async function main() {
  // 1. Every annotation type on a normal page.
  {
    const bytes = new Uint8Array(readFileSync(`${OUT}/report.pdf`))
    const pages = await pagesOf(bytes)
    const out = await exportPdf(bytes, pages, allAnnoTypes(0), {}, {})
    const reread = await PDFDocument.load(out)
    check('all annotation types export', reread.getPageCount() === 1, `${out.length} bytes`)
    writeFileSync(`${OUT_DIR}/out-annos.pdf`, out)
  }

  // 2. Form values round-trip.
  {
    const bytes = new Uint8Array(readFileSync(`${OUT}/form.pdf`))
    const pages = await pagesOf(bytes)
    const values = {
      'applicant.name': 'Ada Lovelace',
      'applicant.email': 'sid@example.com',
      'applicant.tier': 'Premium',
      'agree.terms': 'Yes',
      'agree.newsletter': '',
      'applicant.notes': 'Line one\nLine two',
    }
    const out = await exportPdf(bytes, pages, [], values, {})
    writeFileSync(`${OUT_DIR}/out-form.pdf`, out)

    const form = (await PDFDocument.load(out)).getForm()
    const name = form.getField('applicant.name') as PDFTextField
    const tier = form.getField('applicant.tier') as PDFRadioGroup
    const terms = form.getField('agree.terms') as PDFCheckBox
    const news = form.getField('agree.newsletter') as PDFCheckBox
    const notes = form.getField('applicant.notes') as PDFTextField
    check('text field value', name.getText() === 'Ada Lovelace', String(name.getText()))
    check('radio group selection', tier.getSelected() === 'Premium', String(tier.getSelected()))
    check('checkbox checked', terms.isChecked() === true)
    check('checkbox left unchecked', news.isChecked() === false)
    check('multiline text field', notes.getText() === 'Line one\nLine two')
  }

  // 3. Flattening produces a non-interactive document.
  {
    const bytes = new Uint8Array(readFileSync(`${OUT}/form.pdf`))
    const pages = await pagesOf(bytes)
    const out = await exportPdf(
      bytes,
      pages,
      [],
      { 'applicant.name': 'Flattened' },
      {},
      { flattenForm: true },
    )
    const form = (await PDFDocument.load(out)).getForm()
    check('flatten removes fields', form.getFields().length === 0, `${form.getFields().length} left`)
  }

  // 4. Rotated page: the drawn rect must land inside the visible page area.
  {
    const bytes = new Uint8Array(readFileSync(`${OUT}/checklist.pdf`))
    const pages = await pagesOf(bytes)
    const rotated = pages[1]
    check('rotated page reports swapped size', rotated.rotation === 90 && rotated.width === 792)

    const anno = allAnnoTypes(1)
    const out = await exportPdf(bytes, pages, anno, {}, {})
    writeFileSync(`${OUT_DIR}/out-rotated.pdf`, out)
    check('rotated page export', out.length > 0)

    // Isolate the rotated page so it can be rendered and eyeballed.
    const solo = await PDFDocument.create()
    const [copied] = await solo.copyPages(await PDFDocument.load(out), [1])
    solo.addPage(copied)
    writeFileSync(`${OUT_DIR}/out-rotated-p2.pdf`, await solo.save())

    // A view-space point maps back through the inverse into the MediaBox.
    const [px, py] = [
      rotated.inverse[0] * 10 + rotated.inverse[2] * 10 + rotated.inverse[4],
      rotated.inverse[1] * 10 + rotated.inverse[3] * 10 + rotated.inverse[5],
    ]
    check(
      'rotated inverse stays inside the page box',
      px >= 0 && px <= 612 && py >= 0 && py <= 792,
      `(${px.toFixed(1)}, ${py.toFixed(1)})`,
    )
  }

  // 5. Very small marks must still export.
  {
    const bytes = new Uint8Array(readFileSync(`${OUT}/report.pdf`))
    const pages = await pagesOf(bytes)
    const tiny: Anno[] = [3, 6, 10].flatMap((size, i) => [
      { id: `t${i}`, type: 'check' as const, page: 0, rect: { x: 60 + i * 30, y: 600, w: size, h: size }, color: rgbBlack, width: 0.5 },
      { id: `d${i}`, type: 'dot' as const, page: 0, rect: { x: 60 + i * 30, y: 630, w: size, h: size }, color: rgbBlack, width: 0.5 },
    ])
    const out = await exportPdf(bytes, pages, tiny, {}, {})
    check('small marks export', out.length > 0)
    writeFileSync(`${OUT_DIR}/out-small-marks.pdf`, out)
  }

  // 6. Non-WinAnsi text must not throw.
  {
    const bytes = new Uint8Array(readFileSync(`${OUT}/report.pdf`))
    const pages = await pagesOf(bytes)
    const anno: Anno[] = [
      {
        id: 'u1',
        type: 'textBox',
        page: 0,
        rect: { x: 60, y: 200, w: 300, h: 40 },
        text: 'Smart “quotes”, em—dash, ellipsis… and 日本語 fallback',
        fontSize: 12,
        color: rgbBlack,
        align: 'left',
        border: false,
        bg: null,
        font: 'helvetica',
        bold: false,
        italic: false,
      },
    ]
    let ok = true
    try {
      await exportPdf(bytes, pages, anno, {}, {})
    } catch {
      ok = false
    }
    check('unsupported glyphs are folded, not fatal', ok)
  }

  // 7. Pasted text carries invisible bidi and zero-width marks; one of those in
  //    a form value used to fail the entire export at save() time.
  {
    const bytes = new Uint8Array(readFileSync(`${OUT}/form.pdf`))
    const pages = await pagesOf(bytes)
    const nasty =
      '\u202D+34 932 95 28 00\u202C' + '\u200B' + '\uFEFF' + ' \u2066rtl\u2069'
    const values = {
      'applicant.name': nasty,
      'applicant.email': 'caf\u00e9 \u2014 na\u00efve \u201cquoted\u201d',
      'applicant.notes': 'CJK \u65e5\u672c\u8a9e and emoji \u{1F600}',
    }
    let ok = true
    let message = ''
    let out = new Uint8Array()
    try {
      out = await exportPdf(bytes, pages, [], values, {})
    } catch (e) {
      ok = false
      message = e instanceof Error ? e.message : String(e)
    }
    check('invisible/bidi characters do not fail the export', ok, message)

    if (ok) {
      const form = (await PDFDocument.load(out)).getForm()
      const name = (form.getField('applicant.name') as PDFTextField).getText() ?? ''
      check(
        'invisible marks are removed, not substituted',
        name === '+34 932 95 28 00 rtl',
        JSON.stringify(name),
      )
      const email = (form.getField('applicant.email') as PDFTextField).getText() ?? ''
      check('accented and typographic characters survive', email.includes('café'), email)
      const notes = (form.getField('applicant.notes') as PDFTextField).getText() ?? ''
      check('unencodable scripts degrade to placeholders', notes.startsWith('CJK ?'), notes)
    }
  }

  console.log(results.join('\n'))
  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
