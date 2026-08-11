import { useCallback, useEffect, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { useDoc } from './store/document'
import { loadPdf } from './pdf/loader'
import { countUnsupportedFields, readFormFields, readFormValues } from './pdf/formFields'
import Toolbar from './components/Toolbar'
import PageView from './components/PageView'
import Inspector from './components/Inspector'
import type { ToolId } from './types'
import './App.css'

/** Bumped whenever behaviour changes, so a stale tab is identifiable on sight. */
const APP_REV = 'rev 12'

const SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  e: 'edit',
  x: 'text',
  c: 'check',
  k: 'cross',
  r: 'dot',
  s: 'ink',
  b: 'rect',
  l: 'line',
  h: 'highlight',
}

export default function App() {
  const s = useDoc()
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const open = useCallback(
    async (file: File) => {
      setLoading(true)
      s.setStatus('Opening…')
      try {
        const doc = await loadPdf(file)
        let fields: ReturnType<typeof readFormFields> = []
        let values: Record<string, string> = {}
        let unsupported = 0
        try {
          const pdfLibDoc = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
          fields = readFormFields(pdfLibDoc, doc.pages)
          values = readFormValues(pdfLibDoc)
          unsupported = countUnsupportedFields(pdfLibDoc)
        } catch {
          // No usable AcroForm — the stamp tools cover this case.
        }
        doc.initialFormValues = { ...values }
        s.openDoc(doc, fields, values)
        const note = unsupported
          ? ` · ${unsupported} field(s) of an unsupported type are not shown`
          : ''
        s.setStatus(
          fields.length
            ? `${doc.pages.length} page(s) · ${fields.length} interactive form field(s) detected${note}`
            : `${doc.pages.length} page(s) · no interactive form fields — use the tick/dot tools${note}`,
        )
      } catch (err) {
        s.setStatus(`Could not open: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setLoading(false)
      }
    },
    [s],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useDoc.getState().redo()
        else useDoc.getState().undo()
        return
      }
      if (typing) return

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        useDoc.getState().deleteSelected()
        return
      }
      if (e.key === 'Escape') {
        useDoc.getState().select(null)
        useDoc.getState().setTool('select')
        return
      }
      const tool = SHORTCUTS[e.key.toLowerCase()]
      if (tool && !e.metaKey && !e.ctrlKey && !e.altKey) useDoc.getState().setTool(tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file?.type === 'application/pdf') void open(file)
      }}
    >
      <Toolbar onOpen={(f) => void open(f)} />

      <div className="body">
        <div className="viewer">
          {!s.doc && !loading && (
            <div className={`dropzone${dragOver ? ' over' : ''}`}>
              <h1>PDF Editor <span className="rev">{APP_REV}</span></h1>
              <p>Drop a PDF here, or use “Open PDF”.</p>
              <ul>
                <li>
                  <b>Edit text</b> — pick the Edit tool and click any line to retype or delete it
                </li>
                <li>
                  <b>Text box</b> — drag anywhere to add new text
                </li>
                <li>
                  <b>Ticks &amp; radio dots</b> — click to stamp; real form fields become
                  fillable automatically
                </li>
                <li>
                  <b>Sign, highlight, shapes</b> — and download when you are done
                </li>
              </ul>
              <p className="fine">Everything runs in your browser. Nothing is uploaded.</p>
            </div>
          )}
          {loading && <div className="dropzone">Opening…</div>}
          {s.doc && s.pages.map((p) => <PageView key={p.index} info={p} />)}
        </div>
        {s.doc && <Inspector />}
      </div>

      <div className="status">
        <span>{s.status}</span>
        <span className="rev" title="Reload the page if this is not the revision you expect">
          {APP_REV}
        </span>
      </div>
    </div>
  )
}
