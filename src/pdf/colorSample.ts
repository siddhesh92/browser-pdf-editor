import type { RGB, Rect } from '../types'

const WHITE: RGB = { r: 1, g: 1, b: 1 }
const BLACK: RGB = { r: 0, g: 0, b: 0 }

/**
 * Guess the text and background colors of a region of the rendered page.
 *
 * A line of text is mostly background by area, so the modal color is the
 * background; the ink is the most frequent color that is far from it. This
 * beats "darkest pixel" because it also handles light text on a dark fill.
 */
export function sampleColors(
  canvas: HTMLCanvasElement,
  rect: Rect,
  /** canvas pixels per PDF unit */
  scale: number,
): { text: RGB; bg: RGB } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { text: BLACK, bg: WHITE }

  const pad = 1
  const x = Math.max(0, Math.floor(rect.x * scale) - pad)
  const y = Math.max(0, Math.floor(rect.y * scale) - pad)
  const w = Math.min(canvas.width - x, Math.ceil(rect.w * scale) + pad * 2)
  const h = Math.min(canvas.height - y, Math.ceil(rect.h * scale) + pad * 2)
  if (w <= 0 || h <= 0) return { text: BLACK, bg: WHITE }

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(x, y, w, h).data
  } catch {
    return { text: BLACK, bg: WHITE }
  }

  // Quantize to 5 bits per channel so anti-aliased pixels cluster together.
  const counts = new Map<number, number>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const key =
      ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (counts.size === 0) return { text: BLACK, bg: WHITE }

  let bgKey = 0
  let bgCount = -1
  for (const [key, count] of counts) {
    if (count > bgCount) {
      bgCount = count
      bgKey = key
    }
  }
  const bg = fromKey(bgKey)

  // Among colors distinct enough from the background, take the most frequent.
  let textKey = -1
  let textScore = 0
  for (const [key, count] of counts) {
    const c = fromKey(key)
    const dist = Math.abs(c.r - bg.r) + Math.abs(c.g - bg.g) + Math.abs(c.b - bg.b)
    if (dist < 0.35) continue
    const score = count * dist
    if (score > textScore) {
      textScore = score
      textKey = key
    }
  }

  const text = textKey >= 0 ? fromKey(textKey) : contrastWith(bg)
  return { text, bg }
}

function fromKey(key: number): RGB {
  const r = ((key >> 10) & 31) << 3
  const g = ((key >> 5) & 31) << 3
  const b = (key & 31) << 3
  return { r: r / 255, g: g / 255, b: b / 255 }
}

function contrastWith(bg: RGB): RGB {
  return bg.r + bg.g + bg.b > 1.5 ? BLACK : WHITE
}

export function toCss(c: RGB): string {
  const v = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255)
  return `rgb(${v(c.r)}, ${v(c.g)}, ${v(c.b)})`
}

export function fromHex(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return BLACK
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

export function toHex(c: RGB): string {
  const v = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${v(c.r)}${v(c.g)}${v(c.b)}`
}
