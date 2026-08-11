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
 * Zero-width and bidi control characters. They ride along invisibly when text
 * is pasted (phone numbers are a common source) and cannot be encoded, so they
 * must be removed rather than replaced — a substitute would show up as visible
 * rubbish for a character that was never meant to be seen.
 */
const INVISIBLE =
  /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '')
}

/** WinAnsi's 0x80-0x9F block, which Latin-1 leaves as controls. */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

/**
 * Fold arbitrary text down to something the standard fonts can encode, without
 * needing a PDFFont to test against. Used for AcroForm values, whose appearance
 * streams are generated deep inside pdf-lib at save time — one unencodable
 * character there fails the entire export, so it has to be cleaned up front.
 */
export function toWinAnsi(text: string): string {
  let out = ''
  for (const ch of stripInvisible(text)) {
    const folded = FOLD[ch] ?? ch
    for (const c of folded) {
      if (c === '\n' || c === '\r') {
        out += c
        continue
      }
      const code = c.codePointAt(0) ?? 0
      const encodable =
        (code >= 0x20 && code <= 0x7e) ||
        (code >= 0xa0 && code <= 0xff) ||
        WINANSI_EXTRA.has(c)
      out += encodable ? c : '?'
    }
  }
  return out
}

/**
 * The 14 standard fonts are WinAnsi-encoded, so anything outside that range
 * would throw at draw time. Fold what we can, drop what we cannot.
 */
export function sanitize(text: string, font: PDFFont): string {
  let out = ''
  for (const ch of stripInvisible(text)) {
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
