import { useDoc } from '../store/document'
import { fromHex, toHex } from '../pdf/colorSample'
import { FONT_LABELS, isTextual, type Align, type FontFamily } from '../types'

/** Properties panel for the selected annotation. */
export default function Inspector() {
  const annos = useDoc((s) => s.annos)
  const selectedId = useDoc((s) => s.selectedId)
  const commit = useDoc((s) => s.commit)
  const deleteSelected = useDoc((s) => s.deleteSelected)

  const anno = annos.find((a) => a.id === selectedId)
  if (!anno) return null

  function update(patch: Record<string, unknown>) {
    commit((list) => list.map((a) => (a.id === selectedId ? ({ ...a, ...patch } as typeof a) : a)))
  }

  return (
    <div className="inspector">
      <div className="inspector-title">{labelFor(anno.type)}</div>

      {isTextual(anno) && (
        <>
          <label className="row">
            <span>Font</span>
            <select
              value={anno.font}
              onChange={(e) => update({ font: e.target.value as FontFamily })}
            >
              {(Object.keys(FONT_LABELS) as FontFamily[]).map((f) => (
                <option key={f} value={f}>
                  {FONT_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <span>Size</span>
            <input
              type="number"
              min={4}
              max={96}
              value={Math.round(anno.fontSize)}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
            />
          </label>
          <div className="row">
            <span>Style</span>
            <div className="btn-row">
              <button
                className={anno.bold ? 'active' : ''}
                onClick={() => update({ bold: !anno.bold })}
              >
                <b>B</b>
              </button>
              <button
                className={anno.italic ? 'active' : ''}
                onClick={() => update({ italic: !anno.italic })}
              >
                <i>I</i>
              </button>
            </div>
          </div>
        </>
      )}

      {anno.type === 'textBox' && (
        <>
          <div className="row">
            <span>Align</span>
            <div className="btn-row">
              {(['left', 'center', 'right'] as Align[]).map((a) => (
                <button
                  key={a}
                  className={anno.align === a ? 'active' : ''}
                  onClick={() => update({ align: a })}
                >
                  {a[0].toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <label className="row">
            <span>Border</span>
            <input
              type="checkbox"
              checked={anno.border}
              onChange={(e) => update({ border: e.target.checked })}
            />
          </label>
          <label className="row">
            <span>Fill</span>
            <input
              type="checkbox"
              checked={anno.bg !== null}
              onChange={(e) => update({ bg: e.target.checked ? { r: 1, g: 1, b: 1 } : null })}
            />
          </label>
          {anno.bg && (
            <label className="row">
              <span>Fill colour</span>
              <input
                type="color"
                value={toHex(anno.bg)}
                onChange={(e) => update({ bg: fromHex(e.target.value) })}
              />
            </label>
          )}
        </>
      )}

      {anno.type === 'textEdit' && (
        <>
          <label className="row">
            <span>Cover</span>
            <input
              type="color"
              value={toHex(anno.bgColor)}
              onChange={(e) => update({ bgColor: fromHex(e.target.value) })}
            />
          </label>
          <p className="note">
            Original: <em>{anno.original.slice(0, 60)}</em>
          </p>
        </>
      )}

      {anno.type === 'rect' && (
        <label className="row">
          <span>Fill</span>
          <input
            type="checkbox"
            checked={anno.fill !== null}
            onChange={(e) => update({ fill: e.target.checked ? { r: 1, g: 1, b: 0.6 } : null })}
          />
        </label>
      )}

      {(anno.type === 'check' || anno.type === 'cross' || anno.type === 'dot') && (
        <label className="row">
          <span>Mark size</span>
          <input
            type="number"
            min={2}
            max={72}
            value={Math.round(anno.rect.w)}
            onChange={(e) => {
              const size = Math.max(2, Number(e.target.value))
              update({
                rect: {
                  x: anno.rect.x + anno.rect.w / 2 - size / 2,
                  y: anno.rect.y + anno.rect.h / 2 - size / 2,
                  w: size,
                  h: size,
                },
              })
            }}
          />
        </label>
      )}

      {'width' in anno && (
        <label className="row">
          <span>Stroke</span>
          <input
            type="number"
            min={0.25}
            max={20}
            step={0.25}
            value={anno.width}
            onChange={(e) => update({ width: Number(e.target.value) })}
          />
        </label>
      )}

      {'color' in anno && (
        <label className="row">
          <span>Colour</span>
          <input
            type="color"
            value={toHex(anno.color)}
            onChange={(e) => update({ color: fromHex(e.target.value) })}
          />
        </label>
      )}

      <button className="danger" onClick={deleteSelected}>
        Delete
      </button>
    </div>
  )
}

function labelFor(type: string): string {
  const names: Record<string, string> = {
    textEdit: 'Edited text',
    textBox: 'Text box',
    check: 'Tick',
    cross: 'Cross',
    dot: 'Radio dot',
    ink: 'Signature',
    rect: 'Rectangle',
    line: 'Line',
    highlight: 'Highlight',
    image: 'Image',
  }
  return names[type] ?? type
}
