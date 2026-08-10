import { useRef, useState } from 'react'
import { newId, useDoc } from '../store/document'
import { exportPdf } from '../pdf/export'
import { fromHex, toHex } from '../pdf/colorSample'
import { FONT_LABELS, isTextual, type FontFamily, type ToolId } from '../types'

const TOOLS: { id: ToolId; label: string; icon: string; hint: string }[] = [
  { id: 'select', label: 'Select', icon: '⌖', hint: 'Select, move and resize (V)' },
  { id: 'edit', label: 'Edit text', icon: 'T̲', hint: 'Click existing text to edit or delete it (E)' },
  { id: 'text', label: 'Text box', icon: '⊞', hint: 'Drag to add a text box (X)' },
  { id: 'check', label: 'Tick', icon: '✓', hint: 'Click to place a tick (C)' },
  { id: 'cross', label: 'Cross', icon: '✕', hint: 'Click to place a cross (K)' },
  { id: 'dot', label: 'Radio dot', icon: '●', hint: 'Click to fill a radio button (R)' },
  { id: 'ink', label: 'Sign', icon: '✎', hint: 'Draw freehand / signature (S)' },
  { id: 'rect', label: 'Box', icon: '▭', hint: 'Drag a rectangle (B)' },
  { id: 'line', label: 'Line', icon: '╱', hint: 'Drag a line (L)' },
  { id: 'highlight', label: 'Highlight', icon: '▬', hint: 'Drag to highlight (H)' },
]

const SWATCHES = ['#111111', '#1a5fe6', '#d92b2b', '#118a3d', '#f0b400', '#ffffff']
const MARK_TOOLS = new Set<ToolId>(['check', 'cross', 'dot'])
const TEXT_TOOLS = new Set<ToolId>(['text', 'edit'])
const MARK_TYPES = new Set<string>(['check', 'cross', 'dot'])

export default function Toolbar({ onOpen }: { onOpen(file: File): void }) {
  const s = useDoc()
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const [flatten, setFlatten] = useState(false)
  const [busy, setBusy] = useState(false)

  const selected = s.annos.find((a) => a.id === s.selectedId)
  // A style group is shown when its tool is active, or when the selection is of
  // that kind — so picking the Tick tool always reveals the mark controls even
  // if a text box happens to still be selected.
  // A focused interactive form field is a styling target in its own right.
  const fieldStyle = s.selectedField ? s.fieldStyles[s.selectedField] : undefined
  const fieldTarget = s.selectedField
    ? (fieldStyle ?? {
        font: s.fontFamily,
        fontSize: s.fontSize,
        bold: s.bold,
        italic: s.italic,
        color: { r: 0, g: 0, b: 0 },
      })
    : null
  const textTarget = selected && isTextual(selected) ? selected : null
  const markTarget = selected && MARK_TYPES.has(selected?.type ?? '') ? selected : null
  const showText = !!fieldTarget || TEXT_TOOLS.has(s.tool) || (s.tool === 'select' && !!textTarget)
  const showMark = MARK_TOOLS.has(s.tool) || (s.tool === 'select' && !!markTarget)

  // Each control reads from the selection when it applies to it, and from the
  // stored defaults otherwise. Changing one does the same, via setStyle.
  const fontSize = fieldTarget?.fontSize ?? textTarget?.fontSize ?? s.fontSize
  const fontFamily = fieldTarget?.font ?? textTarget?.font ?? s.fontFamily
  const bold = fieldTarget?.bold ?? textTarget?.bold ?? s.bold
  const italic = fieldTarget?.italic ?? textTarget?.italic ?? s.italic
  const markSize = markTarget ? Math.round(markTarget.rect.w) : s.markSize
  const strokeWidth = selected && 'width' in selected ? selected.width : s.strokeWidth
  const colour = fieldTarget?.color ?? (selected && 'color' in selected ? selected.color : s.color)

  async function save() {
    if (!s.doc) return
    setBusy(true)
    s.setStatus('Building PDF…')
    try {
      const bytes = await exportPdf(
        s.doc.bytes,
        s.pages,
        s.annos,
        s.formValues,
        s.doc.initialFormValues,
        { flattenForm: flatten },
        s.fieldStyles,
      )
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = s.doc.name.replace(/\.pdf$/i, '') + '-edited.pdf'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      s.setStatus('Saved.')
    } catch (err) {
      s.setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function addImage(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, 200 / img.width)
        s.addAnno({
          id: newId(),
          type: 'image',
          page: s.currentPage,
          rect: { x: 72, y: 72, w: img.width * scale, h: img.height * scale },
          dataUrl,
        })
        s.setTool('select')
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="toolbar">
      <div className="group">
        <button className="primary" onClick={() => fileRef.current?.click()}>
          Open PDF
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onOpen(f)
            e.target.value = ''
          }}
        />
      </div>

      {s.doc && (
        <>
          <div className="group tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={`tool${s.tool === t.id ? ' active' : ''}`}
                title={t.hint}
                onClick={() => s.setTool(t.id)}
              >
                <span className="icon">{t.icon}</span>
                <span className="tool-label">{t.label}</span>
              </button>
            ))}
            <button
              className="tool"
              title="Insert an image or a scanned signature"
              onClick={() => imageRef.current?.click()}
            >
              <span className="icon">🖼</span>
              <span className="tool-label">Image</span>
            </button>
            <input
              ref={imageRef}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) addImage(f)
                e.target.value = ''
              }}
            />
          </div>

          {showText && (
            <div className="group">
              <label
                className="field-label"
                title={
                  fieldTarget
                    ? `Changes the form field "${s.selectedField}"`
                    : scopeHint(!!textTarget)
                }
              >
                {fieldTarget ? 'Field' : `Text${textTarget ? '' : ' ▸ new'}`}
              </label>
              <select
                value={fontFamily}
                title="Font"
                onChange={(e) => s.setStyle({ fontFamily: e.target.value as FontFamily })}
              >
                {(Object.keys(FONT_LABELS) as FontFamily[]).map((f) => (
                  <option key={f} value={f}>
                    {FONT_LABELS[f]}
                  </option>
                ))}
              </select>
              <button
                className={bold ? 'active' : ''}
                title="Bold"
                onClick={() => s.setStyle({ bold: !bold })}
              >
                <b>B</b>
              </button>
              <button
                className={italic ? 'active' : ''}
                title="Italic"
                onClick={() => s.setStyle({ italic: !italic })}
              >
                <i>I</i>
              </button>
              <Stepper
                value={Math.round(fontSize)}
                min={4}
                max={96}
                title="Font size (pt)"
                onChange={(v) => s.setStyle({ fontSize: v })}
              />
            </div>
          )}

          {showMark && (
            <div className="group">
              <label className="field-label" title={scopeHint(!!markTarget)}>
                Mark{markTarget ? '' : ' ▸ new'}
              </label>
              <Stepper
                value={Math.round(markSize)}
                min={2}
                max={72}
                title="Mark size (pt)"
                onChange={(v) => s.setStyle({ markSize: v })}
              />
              <Stepper
                value={strokeWidth}
                min={0.25}
                max={12}
                step={0.25}
                title="Stroke thickness"
                onChange={(v) => s.setStyle({ strokeWidth: v })}
              />
            </div>
          )}

          <div className="group">
            <label className="field-label">Colour</label>
            <div className="swatches">
              {SWATCHES.map((hex) => (
                <button
                  key={hex}
                  className={`swatch${toHex(colour) === hex ? ' active' : ''}`}
                  style={{ background: hex }}
                  onClick={() => s.setStyle({ color: fromHex(hex) })}
                  title={hex}
                />
              ))}
              <input
                type="color"
                value={toHex(colour)}
                onChange={(e) => s.setStyle({ color: fromHex(e.target.value) })}
                title="Custom colour"
              />
            </div>
          </div>

          <div className="group">
            <button onClick={s.undo} disabled={!s.past.length} title="Undo (⌘Z)">
              ↶
            </button>
            <button onClick={s.redo} disabled={!s.future.length} title="Redo (⇧⌘Z)">
              ↷
            </button>
            <button onClick={s.deleteSelected} disabled={!s.selectedId} title="Delete (⌫)">
              🗑
            </button>
          </div>

          <div className="group">
            <button onClick={() => s.setZoom(s.zoom - 0.25)} title="Zoom out">
              −
            </button>
            <span className="num">{Math.round(s.zoom * 100)}%</span>
            <button onClick={() => s.setZoom(s.zoom + 0.25)} title="Zoom in">
              +
            </button>
          </div>

          <div className="group right">
            <label className="checkbox" title="Make filled form fields non-editable in the output">
              <input
                type="checkbox"
                checked={flatten}
                onChange={(e) => setFlatten(e.target.checked)}
              />
              Flatten fields
            </label>
            <button className="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Download'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function scopeHint(hasTarget: boolean): string {
  return hasTarget
    ? 'Changes the selected item'
    : 'Nothing selected — this sets the style for the next item you add'
}

/** A number input with −/+ buttons, so small values are reachable by clicking. */
function Stepper({
  value,
  min,
  max,
  step = 1,
  title,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  title: string
  onChange(v: number): void
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step))
  return (
    <span className="stepper" title={title}>
      <button onClick={() => onChange(clamp(value - step))}>−</button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(clamp(v))
        }}
      />
      <button onClick={() => onChange(clamp(value + step))}>+</button>
    </span>
  )
}
