import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PageInfo } from '../types'
import { invert, type Matrix } from './coords'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface LoadedDoc {
  /** Pristine bytes of the file as opened. Export always starts from these. */
  bytes: Uint8Array
  pdfjsDoc: PDFDocumentProxy
  pages: PageInfo[]
  name: string
  /** Field values as they were in the file — export only writes what changed. */
  initialFormValues: Record<string, string>
}

export async function loadPdf(file: File): Promise<LoadedDoc> {
  const buf = new Uint8Array(await file.arrayBuffer())
  // pdf.js transfers/detaches the buffer it is given, so hand it a copy and
  // keep our own pristine bytes for export.
  const pdfjsDoc = await pdfjs.getDocument({ data: buf.slice() }).promise

  const pages: PageInfo[] = []
  for (let i = 1; i <= pdfjsDoc.numPages; i++) {
    const page = await pdfjsDoc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const transform = vp.transform as Matrix
    pages.push({
      index: i - 1,
      width: vp.width,
      height: vp.height,
      rotation: ((page.rotate % 360) + 360) % 360,
      transform,
      inverse: invert(transform),
    })
  }

  return { bytes: buf, pdfjsDoc, pages, name: file.name, initialFormValues: {} }
}

/**
 * Render a page into a canvas at the given zoom, accounting for device pixel
 * ratio so text stays sharp on retina displays.
 */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  zoom: number,
  signal?: { cancelled: boolean },
): Promise<void> {
  const page = await doc.getPage(pageIndex + 1)
  if (signal?.cancelled) return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const viewport = page.getViewport({ scale: zoom * dpr })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = `${viewport.width / dpr}px`
  canvas.style.height = `${viewport.height / dpr}px`

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  // Widget appearance streams ARE painted (the default). They are not just the
  // tick: for many forms the /Off appearance is an opaque box that masks a
  // checkbox square printed in the page content, so suppressing them leaves the
  // raw square showing and every box looks ticked. FormFieldLayer covers the
  // baked appearance where it would otherwise show through.
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
}
