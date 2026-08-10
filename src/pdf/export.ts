import {
  BlendMode,
  LineCapStyle,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFFont,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib'
import type { Anno, FieldStyle, FontFamily, PageInfo, RGB, Rect } from '../types'
import { placeOnPage, type Matrix } from './coords'
import { sanitize, wrapText } from './text'

const PAD = 2
const LINE_HEIGHT = 1.18
const ASCENT = 0.78

/** family -> [regular, bold, italic, boldItalic] */
const FONT_MATRIX: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  helvetica: [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
  ],
  times: [
    StandardFonts.TimesRoman,
    StandardFonts.TimesRomanBold,
    StandardFonts.TimesRomanItalic,
    StandardFonts.TimesRomanBoldItalic,
  ],
  courier: [
    StandardFonts.Courier,
    StandardFonts.CourierBold,
    StandardFonts.CourierOblique,
    StandardFonts.CourierBoldOblique,
  ],
}

/** Embeds standard fonts on first use, so a document only carries what it needs. */
class Fonts {
  private cache = new Map<StandardFonts, Promise<PDFFont>>()
  private doc: PDFDocument

  constructor(doc: PDFDocument) {
    this.doc = doc
  }

  get(family: FontFamily, bold: boolean, italic: boolean): Promise<PDFFont> {
    const name = (FONT_MATRIX[family] ?? FONT_MATRIX.helvetica)[(bold ? 1 : 0) + (italic ? 2 : 0)]
    let font = this.cache.get(name)
    if (!font) {
      font = this.doc.embedFont(name)
      this.cache.set(name, font)
    }
    return font
  }
}

export interface ExportOptions {
  flattenForm?: boolean
}

export async function exportPdf(
  originalBytes: Uint8Array,
  pages: PageInfo[],
  annos: Anno[],
  formValues: Record<string, string>,
  initialFormValues: Record<string, string>,
  options: ExportOptions = {},
  fieldStyles: Record<string, FieldStyle> = {},
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true })

  applyFormValues(pdfDoc, formValues, initialFormValues, new Set(Object.keys(fieldStyles)))

  const fonts = new Fonts(pdfDoc)
  await applyFieldStyles(pdfDoc, fieldStyles, fonts)

  const pdfPages = pdfDoc.getPages()
  for (const anno of annos) {
    const page = pdfPages[anno.page]
    const info = pages[anno.page]
    if (!page || !info) continue
    await drawAnno(pdfDoc, page, info, anno, fonts)
  }

  if (options.flattenForm) {
    try {
      pdfDoc.getForm().flatten()
    } catch {
      // A malformed AcroForm should not cost the user their annotations.
    }
  }

  return pdfDoc.save()
}

function applyFormValues(
  pdfDoc: PDFDocument,
  values: Record<string, string>,
  initial: Record<string, string>,
  styled: Set<string> = new Set(),
) {
  let form
  try {
    form = pdfDoc.getForm()
  } catch {
    return
  }

  for (const [name, value] of Object.entries(values)) {
    let field
    try {
      field = form.getField(name)
    } catch {
      continue
    }

    // Tick states are always rewritten, even when unchanged. The file's /V is
    // often stale or inherited and disagrees with the appearance we showed the
    // user; writing it back makes /V and /AS agree so other viewers render what
    // this one did. Text fields are left alone unless edited, to avoid
    // regenerating an appearance the user never touched.
    const isChoice =
      field instanceof PDFCheckBox ||
      field instanceof PDFRadioGroup ||
      field instanceof PDFDropdown ||
      field instanceof PDFOptionList
    if (!isChoice && value === initial[name]) continue

    try {
      if (field instanceof PDFTextField) {
        field.setText(value)
        if (!styled.has(name)) fixAutoFontSize(field)
      }
      else if (field instanceof PDFCheckBox) {
        if (value) field.check()
        else field.uncheck()
      }
      else if (field instanceof PDFRadioGroup) {
        if (value) field.select(value)
        else field.clear()
      } else if (field instanceof PDFDropdown) {
        if (value) field.select(value)
        else field.clear()
      } else if (field instanceof PDFOptionList) {
        if (value) field.select(value)
        else field.clear()
      }
    } catch {
      // Value not in the field's option list, or field is read-only.
    }
  }

  try {
    form.updateFieldAppearances()
  } catch {
    /* appearance streams are best-effort */
  }
}

/**
 * Restyle interactive fields: set the default appearance (colour + size) and
 * regenerate each widget's appearance stream with the chosen font, so the file
 * shows the user's styling in any viewer.
 */
async function applyFieldStyles(
  pdfDoc: PDFDocument,
  fieldStyles: Record<string, FieldStyle>,
  fonts: Fonts,
) {
  const entries = Object.entries(fieldStyles)
  if (entries.length === 0) return

  let form
  try {
    form = pdfDoc.getForm()
  } catch {
    return
  }

  for (const [name, style] of entries) {
    let field
    try {
      field = form.getField(name)
    } catch {
      continue
    }
    if (
      !(field instanceof PDFTextField) &&
      !(field instanceof PDFDropdown) &&
      !(field instanceof PDFOptionList)
    ) {
      continue
    }
    try {
      const font = await fonts.get(style.font, style.bold, style.italic)
      const c = style.color
      // The colour lives in the DA string; setFontSize preserves it.
      field.acroField.setDefaultAppearance(
        `${clamp(c.r)} ${clamp(c.g)} ${clamp(c.b)} rg /${font.name} ${style.fontSize} Tf`,
      )
      field.setFontSize(style.fontSize)
      field.updateAppearances(font)
    } catch {
      // A field that refuses restyling keeps its original appearance.
    }
  }
}

/**
 * Multiline fields often carry a default appearance sized to the whole box
 * (either literally, or as size 0 "auto-fit", which pdf-lib resolves the same
 * way). Text then renders one giant clipped line. Cap the size so at least a
 * couple of lines fit — and only when it is genuinely that broken, so fields
 * with a sane declared size are left alone.
 */
function fixAutoFontSize(field: PDFTextField) {
  if (!field.isMultiline()) return
  const height = field.acroField.getWidgets()[0]?.getRectangle().height ?? 0
  if (height <= 0) return

  const max = height / 2.4
  const da = field.acroField.getDefaultAppearance() ?? ''
  const size = Number(/\/\S+\s+([\d.]+)\s+Tf/.exec(da)?.[1] ?? 0)
  if (size === 0 || size > max) field.setFontSize(Math.max(6, Math.min(11, max)))
}

/**
 * Local frame for a view-space rect: origin at its bottom-left corner, x to the
 * right and y up *as seen on screen*, regardless of the page's /Rotate.
 */
function frameFor(info: PageInfo, rect: Rect) {
  const { x, y, angle } = placeOnPage(info.inverse as Matrix, rect)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    angle: degrees((angle * 180) / Math.PI),
    /** local (lx, ly) -> PDF user space */
    at(lx: number, ly: number): { x: number; y: number } {
      return { x: x + lx * cos - ly * sin, y: y + lx * sin + ly * cos }
    },
  }
}

async function drawAnno(
  pdfDoc: PDFDocument,
  page: PDFPage,
  info: PageInfo,
  anno: Anno,
  fonts: Fonts,
) {
  const { w, h } = anno.rect
  const f = frameFor(info, anno.rect)
  const origin = f.at(0, 0)

  switch (anno.type) {
    case 'textEdit': {
      // Cover the original glyphs, with a hair of bleed so nothing peeks out.
      const cover = frameFor(info, {
        x: anno.rect.x - 1,
        y: anno.rect.y - 1,
        w: w + 2,
        h: h + 2,
      })
      const coverOrigin = cover.at(0, 0)
      page.drawRectangle({
        x: coverOrigin.x,
        y: coverOrigin.y,
        width: w + 2,
        height: h + 2,
        rotate: cover.angle,
        color: toRgb(anno.bgColor),
      })
      if (!anno.text) break

      const font = await fonts.get(anno.font, anno.bold, anno.italic)
      // A replaced line is a line, not a box: let it run past the original
      // width rather than wrapping down onto whatever follows it.
      const lines = sanitize(anno.text, font).split('\n')
      const lineHeight = anno.fontSize * LINE_HEIGHT
      // Anchoring to the original size keeps the baseline put as size changes.
      const baseline = h - (anno.baselineSize ?? anno.fontSize) * ASCENT
      lines.forEach((line, i) => {
        const p = f.at(0, baseline - i * lineHeight)
        page.drawText(line, {
          x: p.x,
          y: p.y,
          size: anno.fontSize,
          font,
          color: toRgb(anno.color),
          rotate: f.angle,
        })
      })
      break
    }

    case 'textBox': {
      if (anno.bg) {
        page.drawRectangle({
          x: origin.x,
          y: origin.y,
          width: w,
          height: h,
          rotate: f.angle,
          color: toRgb(anno.bg),
        })
      }
      if (anno.border) {
        page.drawRectangle({
          x: origin.x,
          y: origin.y,
          width: w,
          height: h,
          rotate: f.angle,
          borderColor: toRgb(anno.color),
          borderWidth: 1,
        })
      }
      if (!anno.text) break

      const font = await fonts.get(anno.font, anno.bold, anno.italic)
      const maxWidth = Math.max(w - PAD * 2, 1)
      const lines = wrapText(sanitize(anno.text, font), font, anno.fontSize, maxWidth)
      const lineHeight = anno.fontSize * LINE_HEIGHT
      lines.forEach((line, i) => {
        const textWidth = font.widthOfTextAtSize(line, anno.fontSize)
        const lx =
          anno.align === 'center'
            ? PAD + (maxWidth - textWidth) / 2
            : anno.align === 'right'
              ? PAD + (maxWidth - textWidth)
              : PAD
        const ly = h - PAD - anno.fontSize * ASCENT - i * lineHeight
        const p = f.at(lx, ly)
        page.drawText(line, {
          x: p.x,
          y: p.y,
          size: anno.fontSize,
          font,
          color: toRgb(anno.color),
          rotate: f.angle,
        })
      })
      break
    }

    case 'check':
    case 'cross': {
      const pts: [number, number][][] =
        anno.type === 'check'
          ? [
              [
                [0.14, 0.5],
                [0.4, 0.22],
              ],
              [
                [0.4, 0.22],
                [0.86, 0.76],
              ],
            ]
          : [
              [
                [0.18, 0.82],
                [0.82, 0.18],
              ],
              [
                [0.18, 0.18],
                [0.82, 0.82],
              ],
            ]
      for (const [a, b] of pts) {
        page.drawLine({
          start: f.at(a[0] * w, a[1] * h),
          end: f.at(b[0] * w, b[1] * h),
          thickness: anno.width,
          color: toRgb(anno.color),
          lineCap: LineCapStyle.Round,
        })
      }
      break
    }

    case 'dot': {
      const c = f.at(w / 2, h / 2)
      page.drawCircle({
        x: c.x,
        y: c.y,
        size: (Math.min(w, h) / 2) * 0.62,
        color: toRgb(anno.color),
      })
      break
    }

    case 'ink': {
      for (const path of anno.paths) {
        for (let i = 1; i < path.length; i++) {
          page.drawLine({
            start: f.at(path[i - 1].x * w, (1 - path[i - 1].y) * h),
            end: f.at(path[i].x * w, (1 - path[i].y) * h),
            thickness: anno.width,
            color: toRgb(anno.color),
            lineCap: LineCapStyle.Round,
          })
        }
        if (path.length === 1) {
          const p = f.at(path[0].x * w, (1 - path[0].y) * h)
          page.drawCircle({ x: p.x, y: p.y, size: anno.width / 2, color: toRgb(anno.color) })
        }
      }
      break
    }

    case 'rect': {
      page.drawRectangle({
        x: origin.x,
        y: origin.y,
        width: w,
        height: h,
        rotate: f.angle,
        borderColor: toRgb(anno.color),
        borderWidth: anno.width,
        color: anno.fill ? toRgb(anno.fill) : undefined,
      })
      break
    }

    case 'line': {
      page.drawLine({
        start: f.at(0, anno.flipped ? 0 : h),
        end: f.at(w, anno.flipped ? h : 0),
        thickness: anno.width,
        color: toRgb(anno.color),
        lineCap: LineCapStyle.Round,
      })
      break
    }

    case 'highlight': {
      page.drawRectangle({
        x: origin.x,
        y: origin.y,
        width: w,
        height: h,
        rotate: f.angle,
        color: toRgb(anno.color),
        opacity: 0.4,
        blendMode: BlendMode.Multiply,
      })
      break
    }

    case 'image': {
      const image = await embedDataUrl(pdfDoc, anno.dataUrl)
      if (!image) break
      page.drawImage(image, {
        x: origin.x,
        y: origin.y,
        width: w,
        height: h,
        rotate: f.angle,
      })
      break
    }
  }
}

async function embedDataUrl(pdfDoc: PDFDocument, dataUrl: string) {
  try {
    if (dataUrl.startsWith('data:image/png')) return await pdfDoc.embedPng(dataUrl)
    if (/^data:image\/jpe?g/.test(dataUrl)) return await pdfDoc.embedJpg(dataUrl)
  } catch {
    return null
  }
  return null
}

function toRgb(c: RGB) {
  return rgb(clamp(c.r), clamp(c.g), clamp(c.b))
}

function clamp(n: number) {
  return Math.max(0, Math.min(1, n))
}
