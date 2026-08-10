import type { Rect } from '../types'

export type Matrix = [number, number, number, number, number, number]

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det) return [1, 0, 0, 1, 0, 0]
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ]
}

/** Map an axis-aligned rect through a matrix, re-normalizing the result. */
export function mapRect(m: Matrix, r: Rect): Rect {
  const [x1, y1] = apply(m, r.x, r.y)
  const [x2, y2] = apply(m, r.x + r.w, r.y + r.h)
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  }
}

/**
 * Everything an exporter needs to place a view-space (top-left origin) rect
 * onto a pdf-lib page: the PDF-space anchor for the rect's bottom-left corner
 * and the rotation to draw at, so rotated pages come out right.
 */
export function placeOnPage(
  inverse: Matrix,
  r: Rect,
): { x: number; y: number; angle: number } {
  const [x, y] = apply(inverse, r.x, r.y + r.h)
  const angle = Math.atan2(inverse[1], inverse[0])
  return { x, y, angle }
}

/** PDF-space point for an arbitrary view-space point. */
export function toPdfPoint(
  inverse: Matrix,
  x: number,
  y: number,
): [number, number] {
  return apply(inverse, x, y)
}
