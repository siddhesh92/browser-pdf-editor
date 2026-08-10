/** Where test artefacts (PDFs, screenshots) are written. Override with OUT_DIR. */
import { mkdirSync } from 'node:fs'

export const OUT_DIR = process.env.OUT_DIR ?? 'tmp'
mkdirSync(OUT_DIR, { recursive: true })
