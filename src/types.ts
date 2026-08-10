export type RGB = { r: number; g: number; b: number }
export type Pt = { x: number; y: number }
/** Top-left origin, PDF user-space units (1/72 inch). */
export type Rect = { x: number; y: number; w: number; h: number }

export type Align = 'left' | 'center' | 'right'

/** The three standard-font families, each available in 4 styles. */
export type FontFamily = 'helvetica' | 'times' | 'courier'

export const FONT_LABELS: Record<FontFamily, string> = {
  helvetica: 'Helvetica',
  times: 'Times',
  courier: 'Courier',
}

export const FONT_CSS: Record<FontFamily, string> = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
}

export type ToolId =
  | 'select'
  | 'edit'
  | 'text'
  | 'check'
  | 'cross'
  | 'dot'
  | 'ink'
  | 'rect'
  | 'line'
  | 'highlight'
  | 'image'

interface Base {
  id: string
  page: number
  rect: Rect
}

export interface TextEditAnno extends Base {
  type: 'textEdit'
  original: string
  text: string
  fontSize: number
  /** The original run's size, which fixes the baseline as fontSize changes. */
  baselineSize: number
  color: RGB
  bgColor: RGB
  font: FontFamily
  bold: boolean
  italic: boolean
}

export interface TextBoxAnno extends Base {
  type: 'textBox'
  text: string
  fontSize: number
  color: RGB
  align: Align
  border: boolean
  bg: RGB | null
  font: FontFamily
  bold: boolean
  italic: boolean
}

export interface MarkAnno extends Base {
  type: 'check' | 'cross' | 'dot'
  color: RGB
  width: number
}

export interface InkAnno extends Base {
  type: 'ink'
  /** Normalized 0..1 within rect, so scaling the rect scales the strokes. */
  paths: Pt[][]
  color: RGB
  width: number
}

export interface ShapeAnno extends Base {
  type: 'rect' | 'line'
  color: RGB
  width: number
  fill: RGB | null
  /** Lines only: run bottom-left -> top-right instead of top-left -> bottom-right. */
  flipped?: boolean
}

export interface HighlightAnno extends Base {
  type: 'highlight'
  color: RGB
}

export interface ImageAnno extends Base {
  type: 'image'
  dataUrl: string
}

export type Anno =
  | TextEditAnno
  | TextBoxAnno
  | MarkAnno
  | InkAnno
  | ShapeAnno
  | HighlightAnno
  | ImageAnno

export type TextualAnno = TextEditAnno | TextBoxAnno

export function isTextual(a: Anno): a is TextualAnno {
  return a.type === 'textEdit' || a.type === 'textBox'
}

/** A run of text extracted from the original PDF content stream. */
export interface TextRun {
  page: number
  str: string
  rect: Rect
  /** Baseline y in top-left space. */
  baseline: number
  fontSize: number
  fontName: string
}

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist'

export interface FormWidget {
  page: number
  rect: Rect
  /** For radio groups and checkboxes, the value this widget switches on. */
  exportValue?: string
  /** Whether this individual widget is drawn as on in the original file. */
  on: boolean
}

export interface FormField {
  name: string
  kind: FieldKind
  widgets: FormWidget[]
  options?: string[]
  readOnly: boolean
  multiline?: boolean
  maxLength?: number
}

/** Per-field text styling for interactive AcroForm fields. */
export interface FieldStyle {
  font: FontFamily
  fontSize: number
  bold: boolean
  italic: boolean
  color: RGB
}

export interface PageInfo {
  index: number
  /** Size after the page's own /Rotate is applied — i.e. what you see. */
  width: number
  height: number
  rotation: number
  /** PDF user space -> view space (top-left origin, unzoomed). */
  transform: [number, number, number, number, number, number]
  /** View space -> PDF user space. */
  inverse: [number, number, number, number, number, number]
}
