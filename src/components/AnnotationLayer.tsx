import { useRef, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { endInteraction, useDoc } from '../store/document'
import { isTextual, type Anno, type Rect } from '../types'
import { toCss } from '../pdf/colorSample'
import EditableText from './EditableText'

const HANDLES = [
  { id: 'nw', x: 0, y: 0 },
  { id: 'ne', x: 1, y: 0 },
  { id: 'sw', x: 0, y: 1 },
  { id: 'se', x: 1, y: 1 },
] as const

interface Props {
  page: number
  zoom: number
}

export default function AnnotationLayer({ page, zoom }: Props) {
  const annos = useDoc((s) => s.annos)
  const selectedId = useDoc((s) => s.selectedId)
  const editingId = useDoc((s) => s.editingId)
  const tool = useDoc((s) => s.tool)

  return (
    <>
      {annos
        .filter((a) => a.page === page)
        .map((anno) => (
          <AnnoView
            key={anno.id}
            anno={anno}
            zoom={zoom}
            selected={anno.id === selectedId}
            editing={anno.id === editingId}
            interactive={tool === 'select' || tool === 'edit'}
          />
        ))}
    </>
  )
}

function AnnoView({
  anno,
  zoom,
  selected,
  editing,
  interactive,
}: {
  anno: Anno
  zoom: number
  selected: boolean
  editing: boolean
  interactive: boolean
}) {
  const select = useDoc((s) => s.select)
  const setEditing = useDoc((s) => s.setEditing)
  const patchAnno = useDoc((s) => s.patchAnno)
  const beginInteraction = useDoc((s) => s.beginInteraction)
  const drag = useRef<{ startRect: Rect; x: number; y: number; handle?: string } | null>(null)

  const style: CSSProperties = {
    left: anno.rect.x * zoom,
    top: anno.rect.y * zoom,
    width: anno.rect.w * zoom,
    height: anno.rect.h * zoom,
    pointerEvents: interactive ? 'auto' : 'none',
  }

  function onPointerDown(e: RPointerEvent, handle?: string) {
    if (!interactive) return
    e.stopPropagation()
    select(anno.id)
    // While typing, the textarea owns the pointer so the caret can be placed.
    if (editing) return
    // Otherwise suppress the default focus/selection behaviour, which would
    // steal focus from a textarea we are about to open.
    e.preventDefault()
    beginInteraction()
    drag.current = { startRect: { ...anno.rect }, x: e.clientX, y: e.clientY, handle }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: RPointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / zoom
    const dy = (e.clientY - d.y) / zoom
    patchAnno(anno.id, { rect: resize(d.startRect, d.handle, dx, dy) })
  }

  function onPointerUp(e: RPointerEvent) {
    if (!drag.current) return
    drag.current = null
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    endInteraction()
  }

  return (
    <div
      className={`anno${selected ? ' selected' : ''}`}
      style={style}
      onPointerDown={(e) => onPointerDown(e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        if (!interactive || !isTextual(anno)) return
        e.stopPropagation()
        setEditing(anno.id)
      }}
    >
      <AnnoBody anno={anno} zoom={zoom} editing={editing} />
      {selected &&
        HANDLES.map((h) => (
          <div
            key={h.id}
            className={`handle handle-${h.id}`}
            onPointerDown={(e) => onPointerDown(e, h.id)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        ))}
    </div>
  )
}

function AnnoBody({ anno, zoom, editing }: { anno: Anno; zoom: number; editing: boolean }) {
  const patchAnno = useDoc((s) => s.patchAnno)
  const beginInteraction = useDoc((s) => s.beginInteraction)
  const setEditing = useDoc((s) => s.setEditing)

  function commitText() {
    setEditing(null)
    endInteraction()
  }
  const w = anno.rect.w * zoom
  const h = anno.rect.h * zoom

  switch (anno.type) {
    case 'textEdit':
      return (
        <div className="fill" style={{ background: toCss(anno.bgColor) }}>
          <EditableText
            value={anno.text}
            fontSize={anno.fontSize}
            color={anno.color}
            font={anno.font}
            bold={anno.bold}
            italic={anno.italic}
            zoom={zoom}
            editing={editing}
            noWrap
            onChange={(text) => patchAnno(anno.id, { text })}
            onFocus={beginInteraction}
            onCommit={commitText}
          />
        </div>
      )

    case 'textBox':
      return (
        <div
          className="fill"
          style={{
            background: anno.bg ? toCss(anno.bg) : 'transparent',
            border: anno.border ? `1px solid ${toCss(anno.color)}` : 'none',
          }}
        >
          <EditableText
            value={anno.text}
            fontSize={anno.fontSize}
            color={anno.color}
            align={anno.align}
            font={anno.font}
            bold={anno.bold}
            italic={anno.italic}
            zoom={zoom}
            padding={2}
            editing={editing}
            placeholder="Type…"
            onChange={(text) => patchAnno(anno.id, { text })}
            onFocus={beginInteraction}
            onCommit={commitText}
          />
        </div>
      )

    case 'check':
      return (
        <Svg w={w} h={h}>
          <polyline
            points={`${0.14 * w},${0.5 * h} ${0.4 * w},${0.78 * h} ${0.86 * w},${0.24 * h}`}
            fill="none"
            stroke={toCss(anno.color)}
            strokeWidth={anno.width * zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      )

    case 'cross':
      return (
        <Svg w={w} h={h}>
          <line
            x1={0.18 * w}
            y1={0.18 * h}
            x2={0.82 * w}
            y2={0.82 * h}
            stroke={toCss(anno.color)}
            strokeWidth={anno.width * zoom}
            strokeLinecap="round"
          />
          <line
            x1={0.18 * w}
            y1={0.82 * h}
            x2={0.82 * w}
            y2={0.18 * h}
            stroke={toCss(anno.color)}
            strokeWidth={anno.width * zoom}
            strokeLinecap="round"
          />
        </Svg>
      )

    case 'dot':
      return (
        <Svg w={w} h={h}>
          <circle
            cx={w / 2}
            cy={h / 2}
            r={(Math.min(w, h) / 2) * 0.62}
            fill={toCss(anno.color)}
          />
        </Svg>
      )

    case 'ink':
      return (
        <Svg w={w} h={h}>
          {anno.paths.map((path, i) => (
            <polyline
              key={i}
              points={path.map((p) => `${p.x * w},${p.y * h}`).join(' ')}
              fill="none"
              stroke={toCss(anno.color)}
              strokeWidth={anno.width * zoom}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      )

    case 'rect':
      return (
        <Svg w={w} h={h}>
          <rect
            x={(anno.width * zoom) / 2}
            y={(anno.width * zoom) / 2}
            width={Math.max(0, w - anno.width * zoom)}
            height={Math.max(0, h - anno.width * zoom)}
            fill={anno.fill ? toCss(anno.fill) : 'none'}
            stroke={toCss(anno.color)}
            strokeWidth={anno.width * zoom}
          />
        </Svg>
      )

    case 'line':
      return (
        <Svg w={w} h={h}>
          <line
            x1={0}
            y1={anno.flipped ? h : 0}
            x2={w}
            y2={anno.flipped ? 0 : h}
            stroke={toCss(anno.color)}
            strokeWidth={anno.width * zoom}
            strokeLinecap="round"
          />
        </Svg>
      )

    case 'highlight':
      return (
        <div
          className="fill"
          style={{ background: toCss(anno.color), opacity: 0.4, mixBlendMode: 'multiply' }}
        />
      )

    case 'image':
      return <img className="fill" src={anno.dataUrl} alt="" draggable={false} />
  }
}

function Svg({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  return (
    <svg className="fill" width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible">
      {children}
    </svg>
  )
}

function resize(start: Rect, handle: string | undefined, dx: number, dy: number): Rect {
  if (!handle) return { ...start, x: start.x + dx, y: start.y + dy }

  let { x, y, w, h } = start
  if (handle.includes('w')) {
    x = start.x + dx
    w = start.w - dx
  }
  if (handle.includes('e')) w = start.w + dx
  if (handle.includes('n')) {
    y = start.y + dy
    h = start.h - dy
  }
  if (handle.includes('s')) h = start.h + dy

  // Flipping through zero would invert the drawing; clamp instead.
  const MIN = 2
  if (w < MIN) {
    if (handle.includes('w')) x = start.x + start.w - MIN
    w = MIN
  }
  if (h < MIN) {
    if (handle.includes('n')) y = start.y + start.h - MIN
    h = MIN
  }
  return { x, y, w, h }
}
