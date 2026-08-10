# PDF Editor

A PDF editor that runs entirely in your browser. Edit the text that is already
in a document, add text boxes, fill interactive forms, tick boxes, sign, and
highlight — then download the result.

No server, no upload, no account. The file never leaves your machine.

```sh
npm install
npm run dev        # http://localhost:5173
```

Sample PDFs are in `public/samples/` — drop one in to try it.

## What it does

| Tool | Key | |
| --- | --- | --- |
| Select | `V` | Move, resize and delete anything you've added |
| Edit text | `E` | Click a line of the PDF's own text to retype or delete it |
| Text box | `X` | Drag to add new text anywhere |
| Tick / Cross | `C` / `K` | Click to stamp a ✓ or ✗ |
| Radio dot | `R` | Click to fill in a radio button |
| Sign | `S` | Draw freehand |
| Box / Line | `B` / `L` | Drag a rectangle or a line |
| Highlight | `H` | Drag over text to highlight |
| Image | — | Insert a PNG/JPG, e.g. a scanned signature |

`⌘Z` / `⇧⌘Z` undo and redo, `⌫` deletes the selection, `Esc` returns to Select.

A new text box is ready to type into immediately. Afterwards, **click once to
select and drag it, double-click to type into it again** — keeping those
separate is what lets you drag a box by its text instead of putting a caret in
it.

### Styling

Toolbar style controls follow the selection: with something selected they change
it, with nothing selected they set the default for whatever you add next (the
label reads "▸ new" to say so).

- **Text** — font (Helvetica, Times, Courier), bold, italic, size. All 12
  standard-font variants are supported; only the ones used get embedded.
- **Mark** — size from 2 pt and stroke from 0.25 pt, so a tick can be made small
  enough to sit inside a printed checkbox.
- **Colour** — swatches plus a picker.

### Interactive forms

If the PDF has real AcroForm fields, they are detected on open and rendered as
live inputs, checkboxes and radio groups. Filling them writes proper field
*values*, so the output is still a working form rather than a picture of one.

Click into a field and the Text controls retarget to it — font, bold, italic,
size and colour then apply to that field's contents, written into its default
appearance and widget appearance stream so it renders in any viewer. Tick
"Flatten fields" before downloading to bake the values in.

For flat or scanned PDFs with no form fields, the stamp tools do the same job
visually.

## How text editing works, and its limits

PDF has no editable text model. Text is a stream of glyph-positioning operators
with subset-embedded fonts — there are no words, no lines, no paragraphs. So
editing is **redact-and-retype**: cover the original glyphs with a rectangle
painted in the background colour sampled from the rendered page, then draw the
replacement at the same baseline, size and colour.

Two consequences worth knowing:

- **Text does not reflow.** A replaced line runs past its original width rather
  than wrapping onto whatever follows it.
- **The original characters remain in the file.** This is a *visual* edit, not a
  secure redaction. Do not use it to hide sensitive information.

## Built with

[pdf.js](https://mozilla.github.io/pdf.js/) renders pages and extracts text
geometry; [pdf-lib](https://pdf-lib.js.org/) writes the output; React, Vite,
TypeScript and zustand hold it together. No UI framework.

Annotations live in one flat array in **top-left, unzoomed PDF units**. Only
`src/pdf/coords.ts` knows about PDF's bottom-left origin, and only at export —
which is what keeps rotated pages and non-zero MediaBox origins working.
`src/pdf/export.ts` is the single writer: it loads the *original* bytes, applies
form values and field styles, then draws annotations.

```
src/
  types.ts              annotation model and shared geometry
  store/document.ts     document, annotations, form values, undo/redo
  pdf/loader.ts         file -> pdf.js document, page geometry, canvas rendering
  pdf/coords.ts         view space <-> PDF user space, rotation-aware
  pdf/textLayer.ts      text run extraction and line grouping
  pdf/colorSample.ts    ink/background colour detection from the rendered canvas
  pdf/formFields.ts     AcroForm discovery, values and tick state
  pdf/text.ts           WinAnsi folding and word wrap
  pdf/export.ts         annotations + form values -> output PDF
  components/           Toolbar, PageView, AnnotationLayer, TextItemLayer,
                        FormFieldLayer, EditableText, Inspector
```

## Tests

```sh
npm test           # everything below (needs `npm run dev` running)
npm run verify     # export checks, Node only, no browser
npm run uitest     # real native input against the real app
npm run formtest   # interactive form fields
npm run ghosttest  # pre-filled forms
npm run build      # typecheck + production build
```

The browser suites drive Chrome through the DevTools Protocol using
`scripts/cdp.mjs` — a dependency-free CDP client (raw WebSocket handshake and
frames, no Puppeteer) — and click and type with **native** input events.

That distinction earned its keep. Synthetic `dispatchEvent` clicks differ from
real ones in focus handling and event ordering, and a bug lived exactly in that
gap: an editor was focused inside a `pointerdown` handler, after which Chrome's
own mousedown focus logic immediately blurred it. The synthetic suite passed;
the feature was broken for every real user. `npm run selftest` still runs that
older synthetic harness, and is the weaker signal.

`HEADED=1 npm run uitest` runs in a visible window. Artefacts are written to
`tmp/`; on macOS, `qlmanage -t -s 900 -o . tmp/out-ui.pdf` renders a PDF to PNG
so you can look at the output rather than assert about it. Set `CHROME_PATH` if
Chrome isn't at the default macOS location.

### Inspecting a real PDF

Form-field bugs are almost never reproducible from a generated fixture. To see
what the app makes of a specific file versus what the file actually says:

```sh
node scripts/inspect.mjs "/path/to/form.pdf" [fieldNameToZoomInOn]
```

```
file says ON   : 3  Female, ChkBox-0, Ordinary passport
app renders ON : 3  Female, ChkBox-0, Ordinary passport
boxes drawn    : 74 | smallest widget: 3.8pt
MATCH — the app agrees with the file
```

## Notes from the trenches

Things that cost real time here, in case they save you some:

- **A widget's `/Off` appearance is not empty.** It is often an opaque box
  masking a checkbox square printed into the page content. Suppress appearance
  streams and those squares show through — on a real form, at 3.8 pt, every box
  looks ticked.
- **Tick state lives in `/AS`, not `/V`.** `/V` is *inheritable*, so a box with
  no value picks up its parent field's, and plenty of forms carry a stale one.
  Viewers render from `/AS`; trusting `/V` ticks boxes nobody ticked. Decide per
  *widget* — one field can own many boxes.
- **Radio on-values may be indices.** With an `/Opt` array, a widget's on-value
  is an index into a list of labels while the field reports the label itself.
- **Form widgets can be under 5 px on screen.** Any border or fill you add reads
  as a tick at that size.
- **A hot-replaced zustand store becomes two stores.** Components re-rendered by
  Fast Refresh bind to the new one and the rest keep the old, so the UI silently
  half-works. `import.meta.hot.invalidate()` forces a full reload instead.

## Licence

MIT
