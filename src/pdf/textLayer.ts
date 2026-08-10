import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { TextRun } from '../types'

/** Typical cap-to-baseline share of the em box; good enough for placing a cover box. */
const ASCENT = 0.78

/**
 * Extract positioned text runs for a page, in top-left PDF-space coordinates
 * that match the un-zoomed viewport (so the overlay can just scale by `zoom`).
 *
 * Runs whose text is rotated relative to the page are skipped: the
 * redact-and-retype editor can only place horizontal replacement text.
 */
export async function extractRuns(
  doc: PDFDocumentProxy,
  pageIndex: number,
): Promise<TextRun[]> {
  const page = await doc.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()

  const runs: TextRun[] = []
  for (const item of content.items) {
    if (!('str' in item)) continue
    if (!item.str || !item.str.trim()) continue

    const tx = pdfjs.Util.transform(viewport.transform, item.transform)
    const angle = Math.atan2(tx[1], tx[0])
    if (Math.abs(angle) > 0.02) continue

    const fontSize = Math.hypot(tx[2], tx[3])
    if (fontSize <= 0) continue

    const baseline = tx[5]
    const width = item.width * viewport.scale
    runs.push({
      page: pageIndex,
      str: item.str,
      rect: {
        x: tx[4],
        y: baseline - fontSize * ASCENT,
        w: width,
        h: fontSize,
      },
      baseline,
      fontSize,
      fontName: item.fontName ?? '',
    })
  }
  return runs
}

/**
 * Merge runs that visually form one line. PDF content streams split lines at
 * arbitrary points (kerning, font switches), so a raw run is often a fragment
 * of a word — useless as an edit target on its own.
 */
export function groupIntoLines(runs: TextRun[]): TextRun[] {
  const sorted = [...runs].sort(
    (a, b) => a.baseline - b.baseline || a.rect.x - b.rect.x,
  )

  const lines: TextRun[] = []
  for (const run of sorted) {
    const prev = lines[lines.length - 1]
    const sameLine =
      prev &&
      Math.abs(prev.baseline - run.baseline) < Math.max(1.5, run.fontSize * 0.2) &&
      Math.abs(prev.fontSize - run.fontSize) < run.fontSize * 0.35

    const gap = prev ? run.rect.x - (prev.rect.x + prev.rect.w) : 0
    if (!sameLine || gap > run.fontSize * 1.5 || gap < -run.fontSize) {
      lines.push({ ...run, rect: { ...run.rect } })
      continue
    }

    const needsSpace =
      gap > run.fontSize * 0.14 &&
      !/\s$/.test(prev.str) &&
      !/^\s/.test(run.str)

    prev.str += (needsSpace ? ' ' : '') + run.str
    const right = Math.max(prev.rect.x + prev.rect.w, run.rect.x + run.rect.w)
    const top = Math.min(prev.rect.y, run.rect.y)
    const bottom = Math.max(prev.rect.y + prev.rect.h, run.rect.y + run.rect.h)
    prev.rect.x = Math.min(prev.rect.x, run.rect.x)
    prev.rect.w = right - prev.rect.x
    prev.rect.y = top
    prev.rect.h = bottom - top
    prev.fontSize = Math.max(prev.fontSize, run.fontSize)
  }
  return lines
}

/** Baseline offset from the top of a run's rect — used when drawing replacements. */
export function ascentOf(fontSize: number): number {
  return fontSize * ASCENT
}
