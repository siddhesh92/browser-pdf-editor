import { useDoc } from '../store/document'
import { toCss } from '../pdf/colorSample'
import { FONT_CSS, type FieldStyle, type FormField, type FormWidget } from '../types'

interface Props {
  page: number
  zoom: number
  active: boolean
}

/**
 * Native controls placed over the PDF's real AcroForm widgets. Values live in
 * the store and are written back into the field objects at export time, so the
 * output keeps proper form semantics rather than being a picture of a form.
 */
/** Falls back to a size that fits the widget when the user has set no style. */
function textStyleFor(style: FieldStyle | undefined, boxHeight: number, zoom: number) {
  if (!style) {
    return { fontSize: Math.min(14, Math.max(8, boxHeight * 0.62)) }
  }
  return {
    fontSize: style.fontSize * zoom,
    fontFamily: FONT_CSS[style.font] ?? FONT_CSS.helvetica,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    color: toCss(style.color),
  }
}

export default function FormFieldLayer({ page, zoom, active }: Props) {
  const fields = useDoc((s) => s.fields)
  const values = useDoc((s) => s.formValues)
  const styles = useDoc((s) => s.fieldStyles)
  const selectedField = useDoc((s) => s.selectedField)
  const setFieldValue = useDoc((s) => s.setFieldValue)
  const selectField = useDoc((s) => s.selectField)

  if (!active) return null

  const items: { field: FormField; widget: FormWidget }[] = []
  for (const field of fields) {
    for (const widget of field.widgets) {
      if (widget.page === page) items.push({ field, widget })
    }
  }

  return (
    <>
      {items.map(({ field, widget }, i) => {
        const boxStyle = {
          left: widget.rect.x * zoom,
          top: widget.rect.y * zoom,
          width: widget.rect.w * zoom,
          height: widget.rect.h * zoom,
        }
        const value = values[field.name] ?? ''
        const key = `${field.name}:${i}`
        const disabled = field.readOnly
        const style = styles[field.name]
        const isSelected = selectedField === field.name

        if (field.kind === 'checkbox') {
          // Match the widget, not just the field: one field can own several
          // boxes, and only the one whose value is set should show a tick.
          const on =
            value !== '' && (widget.exportValue === undefined || value === widget.exportValue)
          return (
            <button
              key={key}
              // `covering` masks the widget's baked appearance on the canvas,
              // which is only needed when our state differs from the file's.
              className={`field-toggle${on ? ' on' : ''}${widget.on !== on ? ' covering' : ''}`}
              // Scale the tick to the widget: these boxes are often ~10pt, and
              // a fixed 13px glyph overflows into a solid-looking blob.
              style={{ ...boxStyle, fontSize: Math.max(7, widget.rect.h * zoom * 0.95) }}
              disabled={disabled}
              title={field.name}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                setFieldValue(field.name, on ? '' : (widget.exportValue ?? 'Yes'))
              }
            >
              {on ? '✓' : ''}
            </button>
          )
        }

        if (field.kind === 'radio') {
          const on = value !== '' && value === widget.exportValue
          return (
            <button
              key={key}
              className={`field-radio${on ? ' on' : ''}${widget.on !== on ? ' covering' : ''}`}
              style={boxStyle}
              disabled={disabled}
              title={`${field.name} = ${widget.exportValue ?? ''}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                setFieldValue(field.name, on ? '' : (widget.exportValue ?? ''))
              }
            />
          )
        }

        if (field.kind === 'dropdown' || field.kind === 'optionlist') {
          return (
            <select
              key={key}
              className="field-input"
              style={{ ...boxStyle, ...textStyleFor(style, widget.rect.h * zoom, zoom) }}
              value={value}
              disabled={disabled}
              title={field.name}
              onPointerDown={(e) => e.stopPropagation()}
              onFocus={() => selectField(field.name)}
              onChange={(e) => setFieldValue(field.name, e.target.value)}
            >
              <option value=""></option>
              {(field.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )
        }

        const common = {
          className: `field-input${isSelected ? ' selected' : ''}`,
          style: { ...boxStyle, ...textStyleFor(style, widget.rect.h * zoom, zoom) },
          value,
          disabled,
          title: field.name,
          maxLength: field.maxLength,
          onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
          // Focusing a field points the style controls at it.
          onFocus: () => selectField(field.name),
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            setFieldValue(field.name, e.target.value),
        }
        return field.multiline ? (
          <textarea key={key} {...common} />
        ) : (
          <input key={key} {...common} />
        )
      })}
    </>
  )
}
