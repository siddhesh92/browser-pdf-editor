import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { newId, useDoc } from '../store/document'
import { renderPage } from '../pdf/loader'
import type { Anno, FontFamily, PageInfo, Pt, Rect } from '../types'
import { toCss } from '../pdf/colorSample'
import AnnotationLayer from './AnnotationLayer'
import TextItemLayer from './TextItemLayer'
import FormFieldLayer from './FormFieldLayer'

interface Draft {
  rect: Rect
  points: Pt[]
}

interface Props {
  info: PageInfo
}

export default function PageView({ info }: Props) {
  const doc = useDoc((s) => s.doc)
  const zoom = useDoc((s) => s.zoom)
  const tool = useDoc((s) => s.tool)
  const color = useDoc((s) => s.color)
  const strokeWidth = useDoc((s) => s.strokeWidth)
  const fontSize = useDoc((s) => s.fontSize)
  const fontFamily = useDoc((s) => s.fontFamily)
  const bold = useDoc((s) => s.bold)
  const italic = useDoc((s) => s.italic)
  const markSize = useDoc((s) => s.markSize)
  const addAnno = useDoc((s) => s.addAnno)
  const select = useDoc((s) => s.select)
  const setEditing = useDoc((s) => s.setEditing)
  const setCurrentPage = useDoc((s) => s.setCurrentPage)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  // A fast click can deliver pointerup before React re-renders, so the draft is
  // mirrored in a ref and the ref is what pointerup reads.
  const draftRef = useRef<Draft | null>(null)
  const dragStart = useRef<Pt | null>(null)

  function updateDraft(next: Draft | null) {
    draftRef.current = next
    setDraft(next)
  }

  useEffect(() => {
    if (!doc || !canvasRef.current) return
    const signal = { cancelled: false }
    renderPage(doc.pdfjsDoc, info.index, canvasRef.current, zoom, signal).catch(() => {})
    return () => {
      signal.cancelled = true
    }
  }, [doc, info.index, zoom])

  useEffect(() => {
    const el = overlayRef.current?.parentElement
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.4) {
            setCurrentPage(info.index)
          }
        }
      },
      { threshold: [0.4] },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [info.index, setCurrentPage])

  function pointAt(e: RPointerEvent): Pt {
    const box = overlayRef.current!.getBoundingClientRect()
    return { x: (e.clientX - box.left) / zoom, y: (e.clientY - box.top) / zoom }
  }

  function onPointerDown(e: RPointerEvent) {
    if (e.button !== 0) return
    const p = pointAt(e)

    if (tool === 'select' || tool === 'edit' || tool === 'image') {
      select(null)
      return
    }

    if (tool === 'check' || tool === 'cross' || tool === 'dot') {
      addAnno({
        id: newId(),
        type: tool,
        page: info.index,
        rect: { x: p.x - markSize / 2, y: p.y - markSize / 2, w: markSize, h: markSize },
        color,
        width: strokeWidth,
      })
      return
    }

    dragStart.current = p
    updateDraft({ rect: { x: p.x, y: p.y, w: 0, h: 0 }, points: [p] })
    overlayRef.current?.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: RPointerEvent) {
    if (!dragStart.current) return
    const p = pointAt(e)
    const s = dragStart.current
    updateDraft({
      rect: {
        x: Math.min(s.x, p.x),
        y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x),
        h: Math.abs(p.y - s.y),
      },
      points: tool === 'ink' ? [...(draftRef.current?.points ?? []), p] : [p],
    })
  }

  function onPointerUp(e: RPointerEvent) {
    const start = dragStart.current
    const current = draftRef.current
    dragStart.current = null
    updateDraft(null)
    overlayRef.current?.releasePointerCapture?.(e.pointerId)
    if (!start || !current) return

    const end = pointAt(e)
    const anno = buildAnno({
      tool,
      page: info.index,
      start,
      end,
      rect: current.rect,
      points: current.points,
      color,
      strokeWidth,
      fontSize,
      fontFamily,
      bold,
      italic,
    })
    if (!anno) return
    addAnno(anno)
    // A new text box should be ready to type into straight away.
    if (anno.type === 'textBox') setEditing(anno.id)
  }

  const cursor =
    tool === 'select' ? 'default' : tool === 'edit' ? 'text' : 'crosshair'

  return (
    <div className="page" data-page={info.index}>
      <div className="page-label">{info.index + 1}</div>
      <div className="page-inner" style={{ width: info.width * zoom, height: info.height * zoom }}>
        <canvas ref={canvasRef} />
        <div
          ref={overlayRef}
          className="overlay"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <FormFieldLayer page={info.index} zoom={zoom} active={tool === 'select' || tool === 'edit'} />
          <TextItemLayer
            page={info.index}
            zoom={zoom}
            canvasRef={canvasRef}
            active={tool === 'edit'}
          />
          <AnnotationLayer page={info.index} zoom={zoom} />
          {draft && <Draft draft={draft} zoom={zoom} tool={tool} color={toCss(color)} width={strokeWidth} />}
        </div>
      </div>
    </div>
  )
}

function Draft({
  draft,
  zoom,
  tool,
  color,
  width,
}: {
  draft: Draft
  zoom: number
  tool: string
  color: string
  width: number
}) {
  const { rect, points } = draft
  if (tool === 'ink') {
    return (
      <svg className="draft-svg">
        <polyline
          points={points.map((p) => `${p.x * zoom},${p.y * zoom}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={width * zoom}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (tool === 'line') {
    const [a, b] = [points[0], points[points.length - 1]]
    return (
      <svg className="draft-svg">
        <line
          x1={a.x * zoom}
          y1={a.y * zoom}
          x2={b.x * zoom}
          y2={b.y * zoom}
          stroke={color}
          strokeWidth={width * zoom}
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <div
      className="draft-rect"
      style={{
        left: rect.x * zoom,
        top: rect.y * zoom,
        width: rect.w * zoom,
        height: rect.h * zoom,
        borderColor: color,
        background: tool === 'highlight' ? color : 'transparent',
        opacity: tool === 'highlight' ? 0.35 : 1,
      }}
    />
  )
}

function buildAnno(args: {
  tool: string
  page: number
  start: Pt
  end: Pt
  rect: Rect
  points: Pt[]
  color: { r: number; g: number; b: number }
  strokeWidth: number
  fontSize: number
  fontFamily: FontFamily
  bold: boolean
  italic: boolean
}): Anno | null {
  const { tool, page, start, end, color, strokeWidth, fontSize } = args
  let rect = args.rect

  switch (tool) {
    case 'text': {
      // A bare click still gets a usable box rather than a zero-size one.
      if (rect.w < 12 || rect.h < 10) {
        rect = { x: start.x, y: start.y, w: 180, h: fontSize * 1.6 + 6 }
      }
      return {
        id: newId(),
        type: 'textBox',
        page,
        rect,
        text: '',
        fontSize,
        color,
        align: 'left',
        border: false,
        bg: null,
        font: args.fontFamily,
        bold: args.bold,
        italic: args.italic,
      }
    }

    case 'rect':
      if (rect.w < 3 || rect.h < 3) return null
      return { id: newId(), type: 'rect', page, rect, color, width: strokeWidth, fill: null }

    case 'line': {
      if (Math.abs(end.x - start.x) < 3 && Math.abs(end.y - start.y) < 3) return null
      const flipped = (end.x - start.x) * (end.y - start.y) < 0
      return {
        id: newId(),
        type: 'line',
        page,
        rect: {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          w: Math.max(Math.abs(end.x - start.x), 1),
          h: Math.max(Math.abs(end.y - start.y), 1),
        },
        color,
        width: strokeWidth,
        fill: null,
        flipped,
      }
    }

    case 'highlight':
      if (rect.w < 3 || rect.h < 3) return null
      return { id: newId(), type: 'highlight', page, rect, color }

    case 'ink': {
      const pts = args.points
      if (pts.length < 2) return null
      const pad = strokeWidth
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const box = {
        x: Math.min(...xs) - pad,
        y: Math.min(...ys) - pad,
        w: Math.max(Math.max(...xs) - Math.min(...xs), 1) + pad * 2,
        h: Math.max(Math.max(...ys) - Math.min(...ys), 1) + pad * 2,
      }
      return {
        id: newId(),
        type: 'ink',
        page,
        rect: box,
        // Normalized so resizing the annotation scales the strokes with it.
        paths: [pts.map((p) => ({ x: (p.x - box.x) / box.w, y: (p.y - box.y) / box.h }))],
        color,
        width: strokeWidth,
      }
    }

    default:
      return null
  }
}
