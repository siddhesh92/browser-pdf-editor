# pdf-editor

Client-side PDF editor: edit existing text, add text boxes, fill interactive
forms, stamp ticks/crosses/dots, sign, highlight. React + Vite + TypeScript,
pdf.js for rendering, pdf-lib for writing. No server, nothing uploaded.

See `README.md` for the user-facing description.

## Testing — read this before claiming anything works

`npm run dev` must be running for the browser suites.

```sh
npm test          # all four suites
npm run verify    # export checks, Node only, no browser
npm run uitest    # native input against the real app (CDP)
npm run formtest  # interactive form-field path (CDP)
npm run ghosttest # pre-filled forms: double-render and pre-set choices (CDP)
```

`scripts/cdp.mjs` drives real Chrome with **native** input events. Use it, not
`npm run selftest` (synthetic `dispatchEvent`), when making claims about
interaction — a focus bug here passed the synthetic suite and failed for a real
user. `HEADED=1 npm run uitest` runs it in a visible window.

Outputs land in `tmp/`; render them with `qlmanage -t -s 900 -o . tmp/x.pdf`
and actually look at the result.

**The three paths are genuinely different.** A test on one proves nothing about
the others:

1. **`textEdit`** — replacing text already printed in the page.
2. **`textBox`** — new text the user adds.
3. **AcroForm fields** — the blue boxes, if the PDF has a form.

`report.pdf` has no form fields; `form.pdf` has an empty form; `form-filled.pdf`
has one with values *already set*; `form-quirky.pdf` has checkbox `/V` that
disagrees with `/AS` plus an inherited `/V`; `checklist.pdf` is flat with a
rotated second page. Test against the one that matches the report — an empty form and a
pre-filled one exercise genuinely different code.

## Architecture

Annotations live in one flat array in the store, in **top-left, unzoomed PDF
units**. Only `pdf/coords.ts` knows about PDF's bottom-left origin, and only at
export — that is what keeps rotated pages and non-zero MediaBox origins working.
Form field values and per-field styles live separately from annotations, keyed
by field name, because they are written as real field values rather than drawn.

`pdf/export.ts` is the single writer: it loads the *original* bytes (never a
re-encode), applies form values and field styles, then draws annotations.

## Gotchas that have already bitten

- Text editing is **redact-and-retype**: cover the glyphs, draw new text. The
  original characters stay in the content stream. It is not secure redaction,
  and the UI says so.
- Standard fonts are WinAnsi-encoded; `pdf/text.ts` folds what it can and drops
  the rest. Newlines must survive sanitising — they are structural.
- **Form values must be cleaned before `setText`** (`toWinAnsi`). Their
  appearance streams are generated inside `save()`, so one unencodable character
  fails the *entire* export rather than that one field — and the per-field
  try/catch cannot help, because the throw happens later. Invisible bidi and
  zero-width marks (U+202D and friends) ride along with pasted phone numbers and
  are stripped, not substituted.
- Multiline form fields often carry a default appearance sized to the whole box
  (or size 0 auto-fit), which renders one giant clipped line. `fixAutoFontSize`
  caps it, but only when no explicit user style exists.
- Opening an editor from a `pointerdown` handler requires `preventDefault()`, or
  Chrome's own mousedown focus handling blurs the input we just focused.
- Editing a store module triggers a full page reload on purpose
  (`import.meta.hot.invalidate()`) — see the note in `~/.claude/CLAUDE.md`.
- **Do not suppress widget appearance streams** (`AnnotationMode.ENABLE_FORMS`).
  A widget's `/Off` appearance is often an *opaque box masking a checkbox square
  printed in the page content* — drop it and the raw square shows through, so
  every box looks ticked. The canvas therefore paints appearances as normal, and
  `FormFieldLayer` covers them only where needed: `.field-input` is opaque so a
  baked value cannot ghost beside ours, and tick boxes get `.covering` only when
  our state differs from the file's.
- These widgets can be **under 5px on screen** (3.8pt on a real government
  form). At that size any border or fill of ours reads as a tick. Check a real
  form before styling form controls.
- **Tick state comes from the widget's own `/AS`, never the field's `/V`**
  (`widgetIsOn`). `/V` is *inheritable*, so a box with no value of its own picks
  up a parent field's, and many forms carry a stale `/V` that never matched the
  appearance. pdf-lib's `isChecked()` trusts `/V`; viewers trust `/AS`. A widget
  with no `/AS` at all is **off**. Decide per *widget*, not per field — one field
  can own many boxes, and a field-level boolean ticks all of them at once.
  Export always rewrites tick states, even unchanged ones, so the stale `/V`
  cannot resurface in another viewer. `form-quirky.pdf` is the regression case.
- A radio group may carry an `/Opt` array of display labels, in which case each
  widget's on-value is an **index** into it, while the field's selected value is
  the label. Compare like with like (`resolveOption`) or pre-selected radios
  silently render as empty.
- Bump `APP_REV` in `src/App.tsx` when behaviour changes, so a stale tab is
  identifiable on sight.
