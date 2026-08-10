import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFPage,
  type PDFWidgetAnnotation,
} from 'pdf-lib'
import type { FieldKind, FormField, FormWidget, PageInfo } from '../types'
import { mapRect, type Matrix } from './coords'

/**
 * Discover interactive AcroForm fields and place their widgets in view space,
 * so the overlay can render real inputs on top of them.
 */
export function readFormFields(
  pdfDoc: PDFDocument,
  pages: PageInfo[],
): FormField[] {
  let form
  try {
    form = pdfDoc.getForm()
  } catch {
    return []
  }

  const pageOfDict = buildWidgetPageIndex(pdfDoc.getPages())
  const fields: FormField[] = []

  for (const field of form.getFields()) {
    const kind = kindOf(field)
    if (!kind) continue

    const options =
      field instanceof PDFRadioGroup ||
      field instanceof PDFDropdown ||
      field instanceof PDFOptionList
        ? field.getOptions()
        : undefined

    const widgets: FormWidget[] = []
    for (const widget of field.acroField.getWidgets()) {
      const pageIndex = pageOfDict.get(widget.dict) ?? 0
      const page = pages[pageIndex]
      if (!page) continue

      const r = widget.getRectangle()
      const rect = mapRect(page.transform as Matrix, {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      })
      if (rect.w < 1 || rect.h < 1) continue

      let exportValue: string | undefined
      if (kind === 'radio' || kind === 'checkbox') {
        exportValue = widget.getOnValue()?.decodeText()
      }
      if (kind === 'radio') exportValue = resolveOption(exportValue, options)
      widgets.push({ page: pageIndex, rect, exportValue, on: widgetIsOn(widget) })
    }
    if (widgets.length === 0) continue

    fields.push({
      name: field.getName(),
      kind,
      widgets,
      options,
      readOnly: field.isReadOnly(),
      multiline: field instanceof PDFTextField ? field.isMultiline() : undefined,
      maxLength:
        field instanceof PDFTextField ? field.getMaxLength() : undefined,
    })
  }

  return fields
}

/**
 * Fields whose type we do not render a control for. They matter because the
 * canvas is drawn with ENABLE_FORMS, which suppresses every widget's baked
 * appearance — so anything we do not draw ourselves becomes invisible.
 */
export function countUnsupportedFields(pdfDoc: PDFDocument): number {
  try {
    return pdfDoc
      .getForm()
      .getFields()
      .filter((f) => kindOf(f) === null).length
  } catch {
    return 0
  }
}

/** Initial values as they exist in the file, keyed by field name. */
export function readFormValues(pdfDoc: PDFDocument): Record<string, string> {
  const values: Record<string, string> = {}
  let form
  try {
    form = pdfDoc.getForm()
  } catch {
    return values
  }

  for (const field of form.getFields()) {
    const name = field.getName()
    try {
      if (field instanceof PDFTextField) values[name] = field.getText() ?? ''
      else if (field instanceof PDFCheckBox) values[name] = checkboxValue(field)
      else if (field instanceof PDFRadioGroup) values[name] = radioState(field)
      else if (field instanceof PDFDropdown)
        values[name] = field.getSelected()[0] ?? ''
      else if (field instanceof PDFOptionList)
        values[name] = field.getSelected()[0] ?? ''
    } catch {
      values[name] = ''
    }
  }
  return values
}

/**
 * A single widget is drawn as on only when its own appearance state says so.
 *
 * The field's /V is deliberately *not* consulted. /V is an inheritable
 * attribute, so a box with no value of its own picks up a parent field's, and
 * plenty of forms carry a stale /V that never matched their appearance. Trusting
 * it ticked whole groups of boxes that every viewer draws empty. A widget with
 * no /AS at all is off, which is also how viewers render it.
 */
function widgetIsOn(widget: PDFWidgetAnnotation): boolean {
  const state = widget.getAppearanceState()
  if (!state) return false
  const on = widget.getOnValue()
  return !!on && state === on
}

/**
 * The on-value of whichever widget is drawn on, so a field with several boxes
 * lights up only the one the file actually ticked.
 */
function checkboxValue(field: PDFCheckBox): string {
  for (const w of field.acroField.getWidgets()) {
    if (widgetIsOn(w)) return w.getOnValue()?.decodeText() ?? 'on'
  }
  return ''
}

/** The selected option is whichever widget is drawn on, mapped through /Opt. */
function radioState(field: PDFRadioGroup): string {
  const options = field.getOptions()
  for (const w of field.acroField.getWidgets()) {
    if (widgetIsOn(w)) return resolveOption(w.getOnValue()?.decodeText(), options) ?? ''
  }
  return ''
}

/**
 * A radio group may carry an /Opt array of display labels, in which case each
 * widget's on-value is an *index* into it rather than the value itself. The
 * selected value reported by the field is the label, so map back to labels —
 * otherwise a pre-selected radio never matches and shows as empty.
 */
function resolveOption(onValue: string | undefined, options?: string[]): string | undefined {
  if (onValue === undefined || !options?.length) return onValue
  if (options.includes(onValue)) return onValue
  const index = Number(onValue)
  return Number.isInteger(index) && index >= 0 && index < options.length
    ? options[index]
    : onValue
}

function kindOf(field: unknown): FieldKind | null {
  if (field instanceof PDFTextField) return 'text'
  if (field instanceof PDFCheckBox) return 'checkbox'
  if (field instanceof PDFRadioGroup) return 'radio'
  if (field instanceof PDFDropdown) return 'dropdown'
  if (field instanceof PDFOptionList) return 'optionlist'
  return null
}

/**
 * A widget annotation does not reliably carry a /P back-reference, so walk the
 * pages' /Annots arrays instead and index by the resolved dictionary.
 */
function buildWidgetPageIndex(pdfPages: PDFPage[]): Map<unknown, number> {
  const map = new Map<unknown, number>()
  pdfPages.forEach((page, i) => {
    const annots = page.node.Annots()
    if (!annots) return
    for (let j = 0; j < annots.size(); j++) {
      const dict = page.doc.context.lookup(annots.get(j))
      if (dict) map.set(dict, i)
    }
  })
  return map
}
