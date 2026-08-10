import { useEffect, useState } from 'react'
import { newId, useDoc } from '../store/document'
import { extractRuns, groupIntoLines } from '../pdf/textLayer'
import { sampleColors } from '../pdf/colorSample'
import type { TextRun } from '../types'

interface Props {
  page: number
  zoom: number
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  active: boolean
}

/**
 * Click targets over the page's original text. Clicking one converts it into a
 * `textEdit` annotation: the original glyphs get covered and the string becomes
 * editable in place.
 */
export default function TextItemLayer({ page, zoom, canvasRef, active }: Props) {
  const doc = useDoc((s) => s.doc)
  const annos = useDoc((s) => s.annos)
  const addAnno = useDoc((s) => s.addAnno)
  const setEditing = useDoc((s) => s.setEditing)
  const setStatus = useDoc((s) => s.setStatus)
  const [runs, setRuns] = useState<TextRun[] | null>(null)

  useEffect(() => {
    if (!active || !doc || runs) return
    let cancelled = false
    extractRuns(doc.pdfjsDoc, page)
      .then((raw) => {
        if (!cancelled) setRuns(groupIntoLines(raw))
      })
      .catch(() => {
        if (!cancelled) setRuns([])
      })
    return () => {
      cancelled = true
    }
  }, [active, doc, page, runs])

  if (!active || !runs) return null

  // A run already covered by an edit should not be clickable again.
  const covered = annos.filter((a) => a.page === page && a.type === 'textEdit')

  return (
    <>
      {runs.map((run, i) => {
        const taken = covered.some(
          (a) =>
            Math.abs(a.rect.x - run.rect.x) < 2 && Math.abs(a.rect.y - run.rect.y) < 2,
        )
        if (taken) return null
        return (
          <div
            key={i}
            className="text-hit"
            style={{
              left: run.rect.x * zoom,
              top: run.rect.y * zoom,
              width: run.rect.w * zoom,
              height: run.rect.h * zoom,
            }}
            // Without this the browser's default mousedown focus handling runs
            // after we focus the new textarea and immediately blurs it, so the
            // edit closes the instant it opens.
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              const canvas = canvasRef.current
              // Canvas pixels per PDF unit — includes the device pixel ratio.
              const scale = canvas ? (canvas.width / canvas.clientWidth) * zoom : 1
              const { text, bg } = canvas
                ? sampleColors(canvas, run.rect, scale)
                : { text: { r: 0, g: 0, b: 0 }, bg: { r: 1, g: 1, b: 1 } }
              const id = newId()
              addAnno({
                id,
                type: 'textEdit',
                page,
                rect: { ...run.rect },
                original: run.str,
                text: run.str,
                fontSize: run.fontSize,
                baselineSize: run.fontSize,
                color: text,
                bgColor: bg,
                font: /times|serif|roman|georgia/i.test(run.fontName)
                  ? 'times'
                  : /courier|mono/i.test(run.fontName)
                    ? 'courier'
                    : 'helvetica',
                bold: /bold|black|heavy|semibold/i.test(run.fontName),
                italic: /italic|oblique/i.test(run.fontName),
              })
              setEditing(id)
              setStatus('Editing text — the original characters stay in the file (visual edit).')
            }}
            title={run.str}
          />
        )
      })}
    </>
  )
}
