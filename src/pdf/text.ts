import type { PDFFont } from 'pdf-lib'

/** Characters that are common in PDFs but absent from WinAnsi. */
const FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': ',',
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  ' ': ' ',
  '•': '·',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  '\t': '    ',
}

/**
 * The 14 standard fonts are WinAnsi-encoded, so anything outside that range
 * would throw at draw time. Fold what we can, drop what we cannot.
 */
export function sanitize(text: string, font: PDFFont): string {
  let out = ''
  for (const ch of text) {
    // Newlines are structural — wrapText splits on them after this runs.
    if (ch === '\n') {
      out += ch
      continue
    }
    const folded = FOLD[ch] ?? ch
    for (const c of folded) {
      try {
        font.encodeText(c)
        out += c
      } catch {
        out += '?'
      }
    }
  }
  return out
}

/** Greedy word wrap; falls back to hard character breaks for long tokens. */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (!word) continue
      const candidate = current + word
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current.trimEnd())
        current = word.trimStart()
      } else {
        current = candidate
      }
      while (font.widthOfTextAtSize(current, size) > maxWidth && current.length > 1) {
        let cut = current.length - 1
        while (cut > 1 && font.widthOfTextAtSize(current.slice(0, cut), size) > maxWidth) {
          cut--
        }
        lines.push(current.slice(0, cut))
        current = current.slice(cut)
      }
    }
    lines.push(current.trimEnd())
  }
  return lines
}
