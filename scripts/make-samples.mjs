import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'

const OUT = 'public/samples'
mkdirSync(OUT, { recursive: true })

// 1. A text-heavy document
{
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([612, 792])
  page.drawText('Quarterly Report', { x: 72, y: 700, size: 24, font: bold })
  const lines = [
    'Revenue for the quarter reached 4.2 million dollars, up 18 percent',
    'year over year. Growth was driven primarily by the enterprise segment,',
    'which now accounts for 61 percent of total bookings.',
    '',
    'Operating margin improved to 12.4 percent from 9.1 percent, reflecting',
    'lower customer acquisition costs and improved gross margin on hardware.',
  ]
  lines.forEach((l, i) =>
    page.drawText(l, { x: 72, y: 650 - i * 20, size: 11, font, color: rgb(0.1, 0.1, 0.12) }),
  )
  page.drawText('Prepared by the finance team.', { x: 72, y: 120, size: 10, font, color: rgb(0.4,0.4,0.45) })
  writeFileSync(`${OUT}/report.pdf`, await doc.save())
}

// 2. A fillable form with text fields, checkboxes and a radio group
{
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([612, 792])
  const form = doc.getForm()

  page.drawText('Membership Application', { x: 60, y: 720, size: 18, font: bold })

  page.drawText('Full name', { x: 60, y: 670, size: 11, font })
  form.createTextField('applicant.name').addToPage(page, { x: 160, y: 664, width: 350, height: 22 })

  page.drawText('Email', { x: 60, y: 634, size: 11, font })
  form.createTextField('applicant.email').addToPage(page, { x: 160, y: 628, width: 350, height: 22 })

  page.drawText('Membership tier', { x: 60, y: 580, size: 11, font })
  const tier = form.createRadioGroup('applicant.tier')
  const tiers = ['Basic', 'Standard', 'Premium']
  tiers.forEach((t, i) => {
    tier.addOptionToPage(t, page, { x: 160, y: 578 - i * 28, width: 14, height: 14 })
    page.drawText(t, { x: 182, y: 578 - i * 28 + 2, size: 11, font })
  })

  page.drawText('Agreements', { x: 60, y: 470, size: 11, font })
  const terms = form.createCheckBox('agree.terms')
  terms.addToPage(page, { x: 160, y: 468, width: 14, height: 14 })
  page.drawText('I accept the terms and conditions', { x: 182, y: 470, size: 11, font })

  const news = form.createCheckBox('agree.newsletter')
  news.addToPage(page, { x: 160, y: 440, width: 14, height: 14 })
  page.drawText('Send me the newsletter', { x: 182, y: 442, size: 11, font })

  page.drawText('Notes', { x: 60, y: 400, size: 11, font })
  const notes = form.createTextField('applicant.notes')
  notes.enableMultiline()
  notes.addToPage(page, { x: 160, y: 320, width: 350, height: 90 })

  writeFileSync(`${OUT}/form.pdf`, await doc.save())
}

// 3. A flat form (no AcroForm) with drawn boxes, plus a rotated page
{
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  page.drawText('Inspection Checklist (flat, no form fields)', { x: 60, y: 720, size: 14, font })
  const items = ['Brakes', 'Lights', 'Tyres', 'Wipers']
  items.forEach((item, i) => {
    const y = 660 - i * 34
    page.drawRectangle({ x: 60, y, width: 14, height: 14, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText(item, { x: 86, y: y + 2, size: 11, font })
    page.drawText('Pass', { x: 240, y: y + 2, size: 11, font })
    page.drawCircle({ x: 290, y: y + 7, size: 7, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText('Fail', { x: 320, y: y + 2, size: 11, font })
    page.drawCircle({ x: 365, y: y + 7, size: 7, borderColor: rgb(0, 0, 0), borderWidth: 1 })
  })

  const rotated = doc.addPage([612, 792])
  rotated.setRotation({ type: 'degrees', angle: 90 })
  rotated.drawText('This page is rotated 90 degrees', { x: 72, y: 400, size: 16, font })

  writeFileSync(`${OUT}/checklist.pdf`, await doc.save())
}

// 4. A form that already has values — reproduces the double-render, where the
//    widget's baked appearance is painted onto the canvas *and* again by our
//    HTML overlay.
{
  const bytes = readFileSync(`${OUT}/form.pdf`)
  const doc = await PDFDocument.load(bytes)
  const form = doc.getForm()
  form.getTextField('applicant.name').setText('Prefilled Name')
  form.getTextField('applicant.email').setText('+34 932 95 28 00')
  form.getRadioGroup('applicant.tier').select('Standard')
  form.getCheckBox('agree.terms').check()
  form.updateFieldAppearances()
  writeFileSync(`${OUT}/form-filled.pdf`, await doc.save())
}

// 5. A form whose checkbox /V disagrees with the widget appearance state, and
//    whose checkboxes inherit /V from a parent field. Real forms do this, and
//    viewers render from /AS — so these must show as UNchecked.
{
  const bytes = readFileSync(`${OUT}/form.pdf`)
  const doc = await PDFDocument.load(bytes)
  const form = doc.getForm()
  const ctx = doc.context

  // Value says "on", appearance state says "off" — the viewer believes /AS.
  const terms = form.getCheckBox('agree.terms')
  terms.acroField.dict.set(PDFName.of('V'), PDFName.of('Yes'))
  for (const w of terms.acroField.getWidgets()) w.setAppearanceState(PDFName.of('Off'))

  // Value says "on" and there is no appearance state at all — viewers draw
  // this empty, so we must too.
  const news = form.getCheckBox('agree.newsletter')
  news.acroField.dict.set(PDFName.of('V'), PDFName.of('Yes'))
  for (const w of news.acroField.getWidgets()) w.dict.delete(PDFName.of('AS'))

  // And a parent field carrying a stray /V that its kid would inherit.
  const parent = ctx.obj({ T: PDFString.of('grp'), V: PDFName.of('Yes') })
  const parentRef = ctx.register(parent)
  news.acroField.dict.delete(PDFName.of('V'))
  news.acroField.dict.set(PDFName.of('Parent'), parentRef)

  writeFileSync(`${OUT}/form-quirky.pdf`, await doc.save())
}

console.log('wrote samples')
