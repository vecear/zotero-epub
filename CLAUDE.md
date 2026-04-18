# CLAUDE.md

This file is project-specific guidance for **Claude Code** working on the
`zotero-epub` plugin. Global / user-level rules come from `~/.claude/CLAUDE.md`
and its sibling files; this file only captures things that are specific to
**this repo**.

---

## What this project is

A Zotero 9 bootstrap plugin that adds a toolbar to the built-in EPUB reader
for fine-grained typography control (font / line-height / image scale),
view-mode toggles, and a font-family menu. All settings are GLOBAL and
persisted via `Zotero.Prefs`.

Release flow: `npm run build` produces `.scaffold/build/zotero-epub-reader.xpi`
which is attached to a GitHub Release tag.

---

## Orientation

- **Single-file feature code**: `src/modules/epubReader.ts` (~1000 LOC) holds
  every toolbar button, pref accessor, CSS builder, and DOM walker. Keep
  related behavior here unless it clearly justifies a new module.
- **Hook wiring**: `src/hooks.ts` calls `registerEpubHooks()` during
  `onStartup` and `unregisterEpubHooks()` during `onShutdown`. Don't register
  listeners anywhere else.
- **Research notes**: `findings.md` documents the Zotero 9 reader API probe
  results — constructor names, private accessors (`_internalReader`,
  `_primaryView`, `_iframeDocument`), and which native methods we leverage.
  If the shape changes between Zotero versions, update §9 there.
- **Project plan**: `task_plan.md` is the original milestone doc (M1–M6).
  Status can drift; treat it as historical context rather than source of truth.

---

## Architecture — the three-layer rule

Every user-visible setting follows the same three-layer pattern. Break one
layer and the regression is silent until someone tests with a specific EPUB:

1. **`getSettings()` reads from `Zotero.Prefs`** — settings are GLOBAL, not
   per-reader. Float prefs go through `prefSetFloat` / `prefGetFloat` (JSON
   string round-trip) because `Zotero.Prefs.set` on a `number` routes to
   `setIntPref`, truncating 1.2 → 1.
2. **`applyStyles()` injects CSS rules** — covers elements that will render
   later (lazy chapters, new iframes). Rule goes into a single
   `<style id="ze-content-style">` in each document head.
3. **`applyInline*Recursive()` forces inline `!important`** — walks every
   existing element and writes inline styles. Beats any EPUB stylesheet
   regardless of specificity.

The reset button (`resetAllSettings()`) must undo all three layers in the
same pass: clear prefs, wipe the stylesheet (`applyStyles(doc, {})`), and
either remove inline properties (`removeInlinePropertyRecursive`) or call the
specific `apply*Recursive(doc, 1 /* or 0 */)` helper that knows the
default-value branch.

---

## Hard-earned pitfalls (don't rediscover)

### Reader hook

- `renderToolbar` fires per reader render; it does **not** re-fire retroactively
  when the plugin hot-reloads. Tell the user to close and reopen the EPUB tab
  after any toolbar-layout change.
- `reader._iframeWindow` is the **reader shell** (resource://zotero/reader/
  reader.html), not the book content. The book lives in
  `reader._internalReader._primaryView._iframeDocument`. `getEpubHandle()`
  already resolves this — use it, don't grab `_iframeWindow` directly.
- `reader.type === "epub"` guard is mandatory: the listener is registered
  globally so it fires for PDFs and snapshots too.

### Toolbar buttons

- Buttons **must have class `toolbar-button`** (plus our own `ze-tb` for
  theming). Without it the React toolbar treats the first click as a focus
  event → double-click needed. Same bug bit us twice.
- Don't wrap multiple buttons in a `<div>` and `append(container)`. The React
  toolbar diff strips the wrapper and swallows its children's events.
  Always `append(button)` individually — even if you'd rather group visually.
- Native `<select>` opens on **mousedown only when already focused**, so in
  this toolbar it needs two clicks. `HTMLSelectElement.showPicker()` would fix
  this but was added in Firefox 121, past Zotero 9's Gecko (115 ESR). Use a
  button + custom popup (`appendFontFamilyMenu()` pattern).

### CSS specificity / body layout

- `html { font-size: Xem }` alone fails for EPUBs with per-chapter stylesheets
  that set fixed `px` font sizes. Inline `!important` force is required as the
  second layer.
- `body { zoom: X }` rescaled the layout box but Zotero's **column / pagination
  viewport stays put**, causing overflow / broken pagination. Never zoom body.
  Zoom on `body > *` works for text-only but breaks mixed-content pages.
- Image rules need three properties to actually beat EPUB stylesheets:
  `zoom: X`, `width: (origW × X)px`, `max-width: none`, `max-height: none`.
  Set `height: auto` to preserve aspect ratio.

### Numeric precision

- Font size must be **integer px offset**, never a ratio. `×1.1 ×1/1.1` does
  not round-trip to 1 with floating-point; `+N` then `−N` does.
- Image scale stays as a ratio (ratios are fine when you **always rebase from
  the cached original**, which `applyInlineImageZoomRecursive` does via
  `dataset.zeOrigW`). Never rebase from "current size" or you'll drift.

### Prefs quirks

- `Zotero.Prefs.set(key, value, true)` — the third param (`global=true`) means
  "don't auto-prefix with `extensions.zotero.`", so we can pass the full path.
- `typeof value === "number"` calls `setIntPref`. Always convert floats to
  strings via `prefSetFloat`.
- Backward compatibility: when renaming a pref key, **clear the legacy key**
  in `clearAllSettings()` so users upgrading between versions don't see
  stale values.

---

## Workflow expectations

### When modifying shared infrastructure

If the change touches any of: `buildCss` / `applyStyles` / `ReaderStyleState` /
`getSettings` / `reset*` / `applyInline*Recursive`, **mentally trace every
button's code path before committing**. The user explicitly asked for this
after repeated regressions ("改字體結果圖片壞掉"). See
`~/.claude/projects/…/zotero-epub/memory/feedback_regression_check.md`.

After a shared-infrastructure change, **give the user a numbered test list**
so they can verify everything in a single pass instead of reporting regressions
one by one.

### When adding a toolbar button

1. Add to the `buttons` array in `onRenderToolbar` with a unique `ze-*` id.
2. Use `appendButton()` (individual `append`, never wrapped).
3. If the button's action has runtime cost or might silently fail, add a
   self-diagnostic alert that triggers **only on the no-op failure case**
   (see `adjustImageScale`'s `inlineCount === 0` branch).

### When adjusting the UI

- `showStatus()` is intentionally silent (only `ztoolkit.log`). The user asked
  for this — don't re-enable the ProgressWindow popup without being asked.
- Keep tooltips in 繁體中文（台灣用語）, consistent with the rest of the
  plugin.

### Before claiming "done"

- Run `npm run build` — must pass both `zotero-plugin build` and
  `tsc --noEmit`. Hot reload can hide TS errors.
- Don't mark a milestone complete based on "it compiles." The release flow
  requires a `.xpi` that actually runs in Zotero 9.

---

## Ignore / don't-touch list

- `addon/`: generated / template assets (manifest, bootstrap.js, locales).
  Only touch `addon/manifest.json` for version-range changes (e.g.
  `strict_max_version`).
- `src/modules/examples.ts` / `src/modules/preferenceScript.ts`: leftover
  template scaffolding. Not deleted (avoids import churn in `hooks.ts`), but
  not meant to ship as features. If you clean them up, also prune the imports
  and related calls in `hooks.ts`.
- `.scaffold/`: build output. In `.gitignore`. Don't commit.

---

## Communication style for this project

- **使用者授權技術決策**：don't ask A/B/C for routine choices; decide and
  inform in one line (see `feedback_autonomy.md` in memory).
- **短 Reply**：use 繁體中文（台灣用語）, keep final summaries to a few
  bullets, no ceremony.
- **推進優先於保證**：when the user says "繼續" / "接下來", advance to the
  next step rather than restating what was done.
