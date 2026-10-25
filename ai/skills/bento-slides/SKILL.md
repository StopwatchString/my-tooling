---
name: bento-slides
description: >-
  Create and edit Bento presentations — single-file .bento.html decks whose
  document is plain JSON in a "#bento-doc" script block. Use whenever the user
  wants a slide deck or presentation: starting from nothing (copy the bundled
  empty app), from source material, or by improving an existing .bento.html.
  Maps content to the right feature (charts, tables, morph transitions, state
  slides, ken-burns, motion paths) instead of static text slides, then writes
  the document JSON in place. Works offline: the agent guide, JSON schema, app
  and sample decks are all bundled with the skill.
---

# Authoring Bento decks

Everything this skill needs is in its own directory (the "Base directory"
the harness gives you; paths below are relative to it). **Don't fetch
anything from bento.page.** Where the guide mentions a bento.page URL, the
local copy below replaces it:

| Local file | Replaces | Use it for |
|---|---|---|
| `reference/agents.md` | bento.page/agents.md | the format: element shapes, recipes, layout grid, gotchas. **Read it before authoring.** |
| `reference/slides.schema.json` | bento.page/schema/slides.json | exact field names and enums when the guide isn't specific enough |
| `app/Bento_Slides.bento.html` | the release download | the empty app you author a new deck into |
| `samples/*.json` | the gallery templates | worked examples of every technique, and embeddable fonts |
| `reference/SOURCE` | | which Bento version these copies are |

Ignore the guide's install instructions (plugin marketplace, curl, skill
zip); they're for other setups.

A Bento deck is one self-contained `.bento.html` file. The document is plain
JSON in a single block:

```html
<script type="application/bento+json" id="bento-doc"> { "format":"bento/slides", ... } </script>
```

You edit **that block only**, in place. Escape every `<` in the JSON as
`<` so it can never contain a literal `</script>`. Leave the rest of the
file (the compressed runtime) untouched.

## Starting from nothing

Copy the bundled app, named after the deck's topic:

```bash
cp "<skill dir>/app/Bento_Slides.bento.html" "<Topic>.bento.html"
```

Its `#bento-doc` block is **empty**. A browser mints a showcase deck on
first open, but on disk there is nothing to discard or copy from. Write your
document into the empty block. Rules for a fresh document:

- Start from the "Minimal valid document" skeleton in `reference/agents.md`.
  `size` and `theme` (including `theme.fontFamily`) are **required**; the app
  won't boot without them.
- **Fully specify element fields** as the skeleton shows (shapes need
  `stroke`/`strokeWidth`; text needs `fontFamily`/`align`/`valign`).
  Missing fields render wrong or not at all.
- **Omit `docId` and `collab`**: the app mints a fresh identity and dormant
  collaboration credentials on first open.

For a large deck, generate the JSON with a small script and splice it in
rather than hand-editing the HTML:

```python
import json, re
src = json.dumps(doc, ensure_ascii=False).replace("<", "\\u003c")
page = open(path, encoding="utf-8").read()
page = re.sub(r'(id="bento-doc">)(.*?)(</script>)',
              lambda m: m.group(1) + src + m.group(3), page, count=1, flags=re.S)
open(path, "w", encoding="utf-8").write(page)
```

## The samples

`samples/<name>.json` are the four gallery templates' documents, as pretty
JSON. Read them for how a technique is really put together; grep for the
feature (`"stateOf"`, `"motion-path"`, `"kenburns"`, `"preset"`) rather than
reading a whole file.

| Sample | Look | Shows |
|---|---|---|
| `orbital-dark-immersive` | dark, cyan accent, Instrument Sans + Space Mono | morph chains, 2 state slides + links, ken-burns, dash-march and motion-path loops, line chart, video |
| `picnic-playful` | yellow/pink, Instrument Sans | count-up numbers, bar chart, motion-path, audio, ken-burns |
| `signal-editorial-type` | paper, red accent, Fraunces + Instrument Sans | editorial type, bar chart, dash-march, ken-burns |
| `terra-premium-product` | warm neutral, Fraunces + Instrument Sans | product photos, pie chart, motion-path, ken-burns |

- **Images and media were cut out** to keep the copies small: their values
  read `"OMITTED: image/jpeg, 122 KB data URI"`. Never copy one of those
  into a deck; embed your own data URI or drop the element.
- **Fonts are kept.** To use Instrument Sans, Fraunces or Space Mono, copy
  the `doc.assets` entry (`font-instrument`, `font-fraunces`,
  `font-spacemono`, `font-spacemono-bold`) and the matching `doc.fonts`
  entry from a sample into your document, and name the family in a full
  stack (`"'Fraunces', Georgia, serif"`).
- The samples set `"template": true`. Remove it if you base a deck on one,
  or every open mints a fresh copy.

## Workflow

1. **Find the document.** Locate the `#bento-doc` block; parse its JSON. Note
   `doc.size` (canonical 1280×720), `doc.theme`, existing element `id`s, and
   whether `doc.template`/`doc.readonly` are set.

   **Check `doc.collab` first.** If it carries `ownerPriv`, `writerPriv` or
   `invite`, this deck's live-session keys are in the file, and anything
   that receives the file or its JSON can join that session and write to
   it. **Tell the user before you continue**; they may not know the deck is
   shared. Offer a read-only copy, or *Share → Stop sharing* on a duplicate.
   If it has already gone somewhere, the remedy is *Share → Rotate keys*.
2. **Read the source material** and classify each piece: a stat? a table? a
   process? a definition to expand? a photo?
3. **Map material → feature (don't default to bullet text):**
   - numbers to compare visually (trend, magnitude, share) → a **chart**
   - a comparison / spec / pricing / feature grid → a **table**
   - consecutive slides about the **same thing changing** → **morph**: same
     element `id` on both slides + `transition:"morph"` on the later one
     (Bento's signature move; reach for it liberally)
   - a point to **drill into** → a **state slide** (`stateOf` + element `link`)
   - a **hero image** → full-bleed image + scrim rect + text, with **ken-burns**
   - a **sequence / flow / timeline** → a line/`path` with a `dash-march`
     loop, or morph a highlight through the steps
   - a **headline number** → big text + `fx:{countUp:true}`
   - **every cover / divider** → at least one ambient motion
   - **repeated chrome / logo** → keep its `id` stable so it morphs in place
   - a **clip / recording** → a **media** element (embed short, link long)
4. **Author** against `reference/agents.md`. One accent colour, ≤2
   typefaces, 96px side margins (right-most x ≤ 1184), and **speaker
   notes** on every slide.
5. **Self-audit:**
   - [ ] numbers rendered as text that should be a **chart**?
   - [ ] consecutive slides on one subject share **ids + `transition:"morph"`**?
   - [ ] at least one **motion moment**, especially on the cover?
   - [ ] a drill-down that would work better as a **state slide**?
   - [ ] one accent colour, ≤2 typefaces, 96px margins?
   - [ ] speaker notes on every slide?
6. **Write back** the edited `#bento-doc` block (escaping `<`). Never
   regenerate the whole HTML file.

## Look at it before you're done

Open the deck (`open` / `xdg-open`); it boots straight into the editor.
**Look at every slide.** Text overflow, crowded elements, a heading that
wrapped to three lines and a chart key the renderer dropped are invisible
in the JSON and obvious on screen.

If you can drive a browser (e.g. headless Chrome over the DevTools
protocol), run `window.bento.validate()` in the page: it reports unknown
properties, text overflow, broken links and `asset:` references, and chart
options the renderer ignores. `window.bento.measure({html, w, fontSize,
lineHeight})` sizes text before you place it. Both are described in
`reference/agents.md`.

## Critical gotchas

- **Charts:** bar/line series `data` must be **plain numbers** (`{value,…}`
  objects coerce to 0; only pie takes `{name,value}`); colour by series, not
  per bar; `option` is pure JSON with template formatters only
  (`{b}`/`{c}`/`{d}`), never functions.
- **Morph needs deterministic, stable ids** shared across the slides that
  should animate together.
- **Images/fonts must be embedded** as data URIs in `doc.assets` and
  referenced by `"asset:<key>"`; the file stays self-contained.
- **HTML in text:** `html` is real inline HTML, so write `&lt;` for a literal
  `<` in visible text (e.g. `os/&lt;os&gt;.sh`).
- **Never regenerate `docId`** when editing an existing deck.
- `template:true` → every open mints a fresh deck; `readonly:true` → the
  file boots straight into the show with no editor.

## Updating the bundled copies

`update.sh` (next to this file) re-downloads the guide, schema, app and
samples from bento.page and rewrites `reference/SOURCE`. Run it only when
the user asks to update Bento, then review the diff.
