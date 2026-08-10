import { useEffect, useRef } from 'react'
import { FONT_CSS, type Align, type FontFamily, type RGB } from '../types'
import { toCss } from '../pdf/colorSample'

interface Props {
  value: string
  fontSize: number
  color: RGB
  font: FontFamily
  align?: Align
  bold?: boolean
  italic?: boolean
  zoom: number
  padding?: number
  /** Typing mode. When false the text is inert, so the box can be dragged. */
  editing: boolean
  /** Replaced lines run past their original width instead of wrapping. */
  noWrap?: boolean
  placeholder?: string
  onChange(value: string): void
  onFocus(): void
  onCommit(): void
}

/**
 * Text inside an annotation. It is only a live textarea while editing — the
 * rest of the time it is an inert preview, so clicks select and drag the box
 * instead of being swallowed by a focused input.
 */
export default function EditableText({
  value,
  fontSize,
  color,
  font,
  align = 'left',
  bold,
  italic,
  zoom,
  padding = 0,
  editing,
  noWrap,
  placeholder,
  onChange,
  onFocus,
  onCommit,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const style = {
    fontSize: fontSize * zoom,
    lineHeight: 1.18,
    color: toCss(color),
    textAlign: align,
    fontFamily: FONT_CSS[font] ?? FONT_CSS.helvetica,
    fontWeight: bold ? 700 : 400,
    fontStyle: italic ? 'italic' : 'normal',
    padding: padding * zoom,
    whiteSpace: noWrap ? 'pre' : 'pre-wrap',
  } as const

  if (!editing) {
    return (
      <div className={`text-preview${noWrap ? ' no-wrap' : ''}`} style={style}>
        {value || <span className="placeholder">{placeholder}</span>}
      </div>
    )
  }

  return (
    <textarea
      ref={ref}
      className="editable-text"
      value={value}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      // Snapshot on focus so a whole typing session undoes as one step.
      onFocus={onFocus}
      onBlur={onCommit}
      wrap={noWrap ? 'off' : 'soft'}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') e.currentTarget.blur()
      }}
      style={style}
    />
  )
}
