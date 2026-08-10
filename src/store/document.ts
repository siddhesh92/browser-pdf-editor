import { create } from 'zustand'
import type {
  Anno,
  FieldStyle,
  FontFamily,
  FormField,
  PageInfo,
  RGB,
  Rect,
  ToolId,
} from '../types'
import type { LoadedDoc } from '../pdf/loader'

const MAX_HISTORY = 100

interface Snapshot {
  annos: Anno[]
  formValues: Record<string, string>
  fieldStyles: Record<string, FieldStyle>
}

/** Style defaults applied to newly created annotations. */
interface Style {
  color: RGB
  strokeWidth: number
  fontSize: number
  fontFamily: FontFamily
  bold: boolean
  italic: boolean
  markSize: number
}

interface State extends Style {
  doc: LoadedDoc | null
  pages: PageInfo[]
  fields: FormField[]
  formValues: Record<string, string>
  /** Style overrides for interactive fields, keyed by field name. */
  fieldStyles: Record<string, FieldStyle>
  annos: Anno[]
  selectedId: string | null
  /** The interactive form field the style controls should act on, if any. */
  selectedField: string | null
  /** The annotation whose text is being typed into, if any. */
  editingId: string | null
  tool: ToolId
  zoom: number
  status: string
  currentPage: number
  past: Snapshot[]
  future: Snapshot[]

  openDoc(doc: LoadedDoc, fields: FormField[], values: Record<string, string>): void
  setTool(tool: ToolId): void
  setZoom(z: number): void
  setStatus(s: string): void
  setCurrentPage(p: number): void
  select(id: string | null): void
  selectField(name: string | null): void
  setEditing(id: string | null): void

  /**
   * Change a style value. It becomes the default for new annotations and is
   * applied to the current selection, so the controls work either way round.
   */
  setStyle(patch: Partial<Style>): void

  commit(mutate: (annos: Anno[]) => Anno[]): void
  addAnno(anno: Anno): void
  /** Live updates during a drag or while typing — no history entry. */
  patchAnno(id: string, patch: Partial<Anno>): void
  beginInteraction(): void
  deleteSelected(): void
  setFieldValue(name: string, value: string): void
  undo(): void
  redo(): void
}

let pendingSnapshot: Snapshot | null = null

/** Which annotation property each style key maps onto, per annotation type. */
function styleToAnnoPatch(patch: Partial<Style>, anno: Anno): Partial<Anno> | null {
  const out: Record<string, unknown> = {}

  if (patch.color !== undefined && 'color' in anno) out.color = patch.color
  if (patch.strokeWidth !== undefined && 'width' in anno) out.width = patch.strokeWidth

  if (anno.type === 'textEdit' || anno.type === 'textBox') {
    if (patch.fontSize !== undefined) out.fontSize = patch.fontSize
    if (patch.fontFamily !== undefined) out.font = patch.fontFamily
    if (patch.bold !== undefined) out.bold = patch.bold
    if (patch.italic !== undefined) out.italic = patch.italic
  }

  // Marks have no size field of their own — their rect *is* their size, so
  // resize it about its centre to keep the mark where the user put it.
  if (
    patch.markSize !== undefined &&
    (anno.type === 'check' || anno.type === 'cross' || anno.type === 'dot')
  ) {
    const size = Math.max(2, patch.markSize)
    out.rect = {
      x: anno.rect.x + anno.rect.w / 2 - size / 2,
      y: anno.rect.y + anno.rect.h / 2 - size / 2,
      w: size,
      h: size,
    } satisfies Rect
  }

  return Object.keys(out).length ? (out as Partial<Anno>) : null
}

export const useDoc = create<State>((set, get) => ({
  doc: null,
  pages: [],
  fields: [],
  formValues: {},
  fieldStyles: {},
  annos: [],
  selectedId: null,
  selectedField: null,
  editingId: null,
  tool: 'select',
  color: { r: 0.1, g: 0.35, b: 0.9 },
  strokeWidth: 1.5,
  fontSize: 12,
  fontFamily: 'helvetica',
  bold: false,
  italic: false,
  markSize: 14,
  zoom: 1.25,
  status: '',
  currentPage: 0,
  past: [],
  future: [],

  openDoc: (doc, fields, formValues) =>
    set({
      doc,
      pages: doc.pages,
      fields,
      formValues,
      fieldStyles: {},
      annos: [],
      selectedId: null,
      selectedField: null,
      editingId: null,
      past: [],
      future: [],
      tool: 'select',
      status: '',
    }),

  setTool: (tool) => set({ tool, editingId: null }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(4, zoom)) }),
  setStatus: (status) => set({ status }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  select: (selectedId) =>
    set((s) => ({
      selectedId,
      selectedField: selectedId ? null : s.selectedField,
      editingId: s.editingId === selectedId ? s.editingId : null,
    })),

  selectField: (selectedField) =>
    set({ selectedField, selectedId: null, editingId: null }),
  setEditing: (editingId) =>
    set((s) => ({ editingId, selectedId: editingId ?? s.selectedId })),

  setStyle: (patch) => {
    const { selectedId, selectedField, annos } = get()

    if (selectedField) {
      set((s) => ({
        past: [...s.past, snapshot(s)].slice(-MAX_HISTORY),
        future: [],
        fieldStyles: {
          ...s.fieldStyles,
          [selectedField]: applyToFieldStyle(s.fieldStyles[selectedField], patch, s),
        },
      }))
      set(patch as Partial<State>)
      return
    }

    const target = annos.find((a) => a.id === selectedId)
    if (target) {
      const annoPatch = styleToAnnoPatch(patch, target)
      if (annoPatch) {
        get().commit((list) =>
          list.map((a) => (a.id === selectedId ? ({ ...a, ...annoPatch } as Anno) : a)),
        )
      }
    }
    set(patch as Partial<State>)
  },

  commit: (mutate) =>
    set((s) => {
      const base = pendingSnapshot ?? snapshot(s)
      pendingSnapshot = null
      return {
        past: [...s.past, base].slice(-MAX_HISTORY),
        future: [],
        annos: mutate(s.annos),
      }
    }),

  addAnno: (anno) =>
    set((s) => ({
      past: [...s.past, snapshot(s)].slice(-MAX_HISTORY),
      future: [],
      annos: [...s.annos, anno],
      selectedId: anno.id,
    })),

  patchAnno: (id, patch) =>
    set((s) => ({
      annos: s.annos.map((a) => (a.id === id ? ({ ...a, ...patch } as Anno) : a)),
    })),

  beginInteraction: () => {
    pendingSnapshot = snapshot(get())
  },

  deleteSelected: () => {
    const id = get().selectedId
    if (!id) return
    get().commit((annos) => annos.filter((a) => a.id !== id))
    set({ selectedId: null, editingId: null })
  },

  setFieldValue: (name, value) =>
    set((s) => ({
      past: [...s.past, snapshot(s)].slice(-MAX_HISTORY),
      future: [],
      formValues: { ...s.formValues, [name]: value },
    })),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1]
      if (!prev) return s
      return {
        past: s.past.slice(0, -1),
        future: [snapshot(s), ...s.future].slice(0, MAX_HISTORY),
        annos: prev.annos,
        formValues: prev.formValues,
        fieldStyles: prev.fieldStyles,
        selectedId: null,
        editingId: null,
      }
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0]
      if (!next) return s
      return {
        past: [...s.past, snapshot(s)].slice(-MAX_HISTORY),
        future: s.future.slice(1),
        annos: next.annos,
        formValues: next.formValues,
        fieldStyles: next.fieldStyles,
        selectedId: null,
        editingId: null,
      }
    }),
}))

/** Defaults come from the current toolbar style, so a field starts sensibly. */
function applyToFieldStyle(
  current: FieldStyle | undefined,
  patch: Partial<Style>,
  defaults: Style,
): FieldStyle {
  const base: FieldStyle = current ?? {
    font: defaults.fontFamily,
    fontSize: defaults.fontSize,
    bold: defaults.bold,
    italic: defaults.italic,
    color: { r: 0, g: 0, b: 0 },
  }
  return {
    font: patch.fontFamily ?? base.font,
    fontSize: patch.fontSize ?? base.fontSize,
    bold: patch.bold ?? base.bold,
    italic: patch.italic ?? base.italic,
    color: patch.color ?? base.color,
  }
}

function snapshot(s: {
  annos: Anno[]
  formValues: Record<string, string>
  fieldStyles: Record<string, FieldStyle>
}): Snapshot {
  return {
    annos: s.annos.map((a) => ({ ...a })),
    formValues: { ...s.formValues },
    fieldStyles: { ...s.fieldStyles },
  }
}

/** Ends a drag/resize/typing session by folding its snapshot into history. */
export function endInteraction() {
  if (!pendingSnapshot) return
  const snap = pendingSnapshot
  pendingSnapshot = null
  useDoc.setState((s) => {
    const changed = JSON.stringify(snap.annos) !== JSON.stringify(s.annos)
    if (!changed) return s
    return { past: [...s.past, snap].slice(-MAX_HISTORY), future: [] }
  })
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// Hot-replacing this module would build a *second* store: components already
// rendered keep subscribing to the old one while the toolbar writes to the new
// one, so controls silently stop working. Force a full reload instead.
if (import.meta.hot) {
  import.meta.hot.invalidate()
}
