import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  PDFWidgetAnnotation,
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

  const widgetsByName = collectPageWidgets(pdfDoc)
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
    for (const { pageIndex, widget } of widgetsByName.get(field.getName()) ?? []) {
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
 * Collect widgets from the *pages*, keyed by fully-qualified field name.
 *
 * Widgets cannot be matched to pages through the AcroForm object graph: some
 * documents carry two parallel sets of objects, where /Fields and a page's
 * /Annots describe the same field with different indirect references, and
 * neither /P nor object identity links them. Viewers draw what is in /Annots,
 * so that is what we enumerate; the AcroForm is consulted only for a field's
 * type, options and value.
 */
function collectPageWidgets(
  pdfDoc: PDFDocument,
): Map<string, { pageIndex: number; widget: PDFWidgetAnnotation }[]> {
  const byName = new Map<string, { pageIndex: number; widget: PDFWidgetAnnotation }[]>()

  pdfDoc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots()
    if (!annots) return

    for (let i = 0; i < annots.size(); i++) {
      const dict = page.doc.context.lookupMaybe(annots.get(i), PDFDict)
      if (!dict) continue
      if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) continue

      const name = qualifiedName(dict)
      if (!name) continue

      const entry = { pageIndex, widget: PDFWidgetAnnotation.fromDict(dict) }
      const list = byName.get(name)
      if (list) list.push(entry)
      else byName.set(name, [entry])
    }
  })

  return byName
}

/** Field names are built from the /T entries up the /Parent chain. */
function qualifiedName(dict: PDFDict): string | null {
  const parts: string[] = []
  let current: PDFDict | undefined = dict

  for (let depth = 0; current && depth < 16; depth++) {
    const t = current.lookupMaybe(PDFName.of('T'), PDFString, PDFHexString)
    if (t) parts.unshift(t.decodeText())
    current = current.lookupMaybe(PDFName.of('Parent'), PDFDict)
  }

  return parts.length ? parts.join('.') : null
}


