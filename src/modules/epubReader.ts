/**
 * EPUB reader integration for Zotero 9.
 *
 * Post-probe strategy (2026-04-18, see findings.md §9):
 *   Zotero 9 Reader exposes rich native APIs on _internalReader.prototype.
 *   We act as a UI extension layer that calls these APIs and renders our
 *   own toolbar controls / settings panels via Zotero.Reader event hooks.
 *
 *   - reader._internalReader        → Reader (src/common/reader.js)
 *   - reader._internalReader._primaryView → EPUBView (src/dom/epub/epub-view.ts)
 *   - reader._internalReader._primaryView._iframeDocument → real EPUB content iframe
 *
 *   Native methods we leverage:
 *     setFontSize, setFontFamily, setHyphenate, setColorScheme
 *     scrollMode (getter), flowMode (getter), spreadMode (getter) + writers TBD
 *     navigate, navigateToNextPage, navigateToNextSection, …
 *     setAnnotations, unsetAnnotations
 *     findNext, findPrevious, toggleFindPopup
 */

import { config } from "../../package.json";

type AnyReader = {
  type?: string;
  itemID?: number;
  _internalReader?: any;
  _iframeWindow?: Window;
};

export interface EpubHandle {
  reader: AnyReader;
  internalReader: any;
  primaryView: any;
  contentDocument: Document | null;
}

/** Resolve EPUB-specific accessors. Returns null for non-EPUB readers. */
export function getEpubHandle(reader: AnyReader): EpubHandle | null {
  if (!reader || reader.type !== "epub") return null;
  const internalReader = reader._internalReader ?? null;
  const primaryView = internalReader?._primaryView ?? null;
  const contentDocument = primaryView?._iframeDocument ?? null;
  return { reader, internalReader, primaryView, contentDocument };
}

export function registerEpubHooks(): void {
  const Reader = (Zotero as any).Reader;
  if (!Reader || typeof Reader.registerEventListener !== "function") {
    ztoolkit.log(`[${config.addonRef}] Zotero.Reader API not found`);
    return;
  }
  Reader.registerEventListener(
    "renderToolbar",
    onRenderToolbar,
    config.addonID,
  );
  ztoolkit.log(`[${config.addonRef}] renderToolbar listener registered`);
}

export function unregisterEpubHooks(): void {
  const Reader = (Zotero as any).Reader;
  if (!Reader || typeof Reader.unregisterEventListener !== "function") return;
  Reader.unregisterEventListener("renderToolbar", onRenderToolbar);
}

function onRenderToolbar(event: {
  reader: AnyReader;
  doc: Document;
  append: (el: Element) => void;
}) {
  const { reader, doc, append } = event;
  if (reader.type !== "epub") return;

  ensureToolbarStyles(doc);

  // Each button is appended individually — wrapping them in a <div> caused
  // clicks to be swallowed (likely Zotero React toolbar diff replacing the
  // wrapper). Keeping the proven single-button pattern from the probe.
  const buttons: Array<[string, string, string, () => void]> = [
    ["ze-font-minus", "A−", "縮小書本內文字體 (步進 0.05)", () => adjustContentFontSize(reader, -0.05)],
    ["ze-font-plus", "A+", "放大書本內文字體 (步進 0.05)", () => adjustContentFontSize(reader, +0.05)],
    ["ze-img-minus", "▭−", "縮小圖片 (步進 0.1)", () => adjustImageScale(reader, -0.1)],
    ["ze-img-plus", "▭+", "放大圖片 (步進 0.1)", () => adjustImageScale(reader, +0.1)],
    ["ze-line-minus", "≡−", "縮小行距", () => adjustLineHeight(reader, -0.1)],
    ["ze-line-plus", "≡+", "放大行距", () => adjustLineHeight(reader, +0.1)],
    ["ze-flow-toggle", "⇅", "切換捲動 / 翻頁模式 (flowMode)", () => toggleFlowMode(reader)],
    ["ze-spread-toggle", "▤", "切換單頁 / 雙頁模式 (spreadMode)", () => toggleSpreadMode(reader)],
    ["ze-reset", "↺", "重置所有自訂設定 (字體/圖片/行距/字型/版面模式)", () => resetAllSettings(reader)],
  ];

  for (const [id, label, title, onClick] of buttons) {
    if (doc.getElementById(id)) continue;
    appendButton(doc, append, id, label, title, onClick);
  }

  if (!doc.getElementById("ze-font-family-btn")) {
    appendFontFamilyMenu(doc, append, reader);
  }

  // Auto-apply persisted GLOBAL settings to this reader once the EPUB
  // view has finished initializing. Wait on the view's own promise so
  // we don't try to inject CSS into an empty document.
  applyPersistedSettings(reader);

  ztoolkit.log(
    `[${config.addonRef}] toolbar attached for EPUB itemID=${reader.itemID}`,
  );
}

function applyPersistedSettings(reader: AnyReader): void {
  const handle = getEpubHandle(reader);
  if (!handle) return;
  const settings = getSettings();
  if (
    settings.fontScale == null &&
    settings.lineHeight == null &&
    settings.fontFamily == null
  ) {
    return;
  }

  const apply = () => {
    const h = getEpubHandle(reader);
    if (!h?.contentDocument) return;
    applyStyles(h.contentDocument, settings);
    if (settings.lineHeight != null) {
      applyInlineLineHeightRecursive(
        h.contentDocument,
        String(settings.lineHeight),
      );
    }
  };

  const initPromise = handle.primaryView?.initializedPromise;
  if (initPromise && typeof initPromise.then === "function") {
    initPromise.then(() => setTimeout(apply, 50)).catch(() => apply());
  } else {
    setTimeout(apply, 200);
  }
}

function ensureToolbarStyles(doc: Document): void {
  const id = "ze-toolbar-styles";
  if (doc.getElementById(id)) return;
  const style = doc.createElement("style");
  style.id = id;
  style.textContent = `
    .ze-tb {
      background: transparent;
      color: #333;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 4px 8px;
      margin: 0 1px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      min-width: 30px;
      white-space: nowrap;
      vertical-align: middle;
      transition: background-color 0.12s, border-color 0.12s, color 0.12s;
    }
    @media (prefers-color-scheme: dark) {
      .ze-tb { color: #e6e6ec; }
    }
    .ze-tb:hover {
      background-color: rgba(127, 127, 127, 0.22);
      border-color: rgba(127, 127, 127, 0.4);
    }
    .ze-tb:active {
      background-color: rgba(127, 127, 127, 0.34);
    }
    .ze-font-menu {
      position: fixed;
      z-index: 999999;
      background: #fff;
      color: #222;
      border: 1px solid #888;
      border-radius: 4px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      min-width: 180px;
      max-width: 320px;
      max-height: 60vh;
      overflow-y: auto;
      padding: 4px 0;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }
    @media (prefers-color-scheme: dark) {
      .ze-font-menu {
        background: #2a2a30;
        color: #e6e6ec;
        border-color: #555;
      }
    }
    .ze-font-menu-item {
      display: block;
      width: 100%;
      text-align: left;
      padding: 6px 16px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      color: inherit;
      white-space: nowrap;
      box-sizing: border-box;
    }
    .ze-font-menu-item:hover {
      background: rgba(127, 127, 127, 0.22);
    }
    .ze-font-menu-item[aria-checked="true"] {
      font-weight: bold;
    }
  `;
  doc.head?.appendChild(style);
}

const FONT_OPTIONS: Array<[string, string]> = [
  ["", "預設字型"],
  ['"Microsoft JhengHei", "微軟正黑體", sans-serif', "微軟正黑體"],
  ['"PMingLiU", "新細明體", "MingLiU", serif', "新細明體"],
  ['"DFKai-SB", "標楷體", "BiauKai", serif', "標楷體"],
  ['"Source Han Sans TC", "Noto Sans CJK TC", "思源黑體", sans-serif', "思源黑體"],
  ['"Source Han Serif TC", "Noto Serif CJK TC", "思源宋體", serif', "思源宋體"],
  ['Georgia, serif', "Georgia"],
  ['"Times New Roman", Times, serif', "Times New Roman"],
  ['Arial, Helvetica, sans-serif', "Arial"],
  ['serif', "系統 Serif"],
  ['sans-serif', "系統 Sans-serif"],
];

/**
 * Custom font-family menu (replaces native <select>).
 *
 * Why: Native <select> dropdown opens on mousedown only when the element
 * is already focused. In Zotero's React-controlled reader toolbar the
 * first click is consumed as focus, so the menu requires a second click.
 * select.showPicker() would solve this but landed in Firefox 121 — Zotero
 * 9 still rides the Firefox 115 ESR Gecko, so it's unavailable.
 *
 * Solution: a button (single-click thanks to .toolbar-button class) that
 * builds an absolute-positioned popup attached to document.body.
 */
function appendFontFamilyMenu(
  doc: Document,
  append: (el: Element) => void,
  reader: AnyReader,
): void {
  const btn = doc.createElement("button");
  btn.id = "ze-font-family-btn";
  // 'toolbar-button' from Zotero is sized as a square icon button
  // (~30×30); a multi-char label like '字型 ▾' overflows to the right
  // and shows hover background only on the icon-sized core. Override
  // with !important so our wider width wins against the host stylesheet.
  btn.className = "toolbar-button ze-tb ze-tb-wide";
  btn.title = "更換字型";
  btn.type = "button";
  btn.style.setProperty("min-width", "70px", "important");
  btn.style.setProperty("width", "auto", "important");
  btn.style.setProperty("padding", "4px 12px", "important");

  const labelOf = (value: string) =>
    FONT_OPTIONS.find((o) => o[0] === value)?.[1] ?? "預設";
  const refreshLabel = () => {
    const cur = getSettings().fontFamily ?? "";
    btn.textContent = "字型 ▾";
    btn.title = `更換字型 (目前: ${labelOf(cur)})`;
  };
  refreshLabel();
  readerLabelRefreshers.set(reader.itemID ?? -1, refreshLabel);

  let menuEl: HTMLDivElement | null = null;
  let outsideHandler: ((ev: Event) => void) | null = null;

  const closeMenu = () => {
    menuEl?.remove();
    menuEl = null;
    if (outsideHandler) {
      doc.removeEventListener("click", outsideHandler, true);
      outsideHandler = null;
    }
  };

  const openMenu = () => {
    closeMenu();
    const rect = btn.getBoundingClientRect();
    const m = doc.createElement("div");
    m.className = "ze-font-menu";
    m.style.top = `${rect.bottom + 2}px`;
    m.style.left = `${rect.left}px`;

    const currentValue = getSettings().fontFamily ?? "";
    for (const [value, label] of FONT_OPTIONS) {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "ze-font-menu-item";
      item.textContent = label;
      if (value === currentValue) item.setAttribute("aria-checked", "true");
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setContentFontFamily(reader, value);
        refreshLabel();
        closeMenu();
      });
      m.appendChild(item);
    }
    doc.body?.appendChild(m);
    menuEl = m;

    // Clamp to viewport: if the menu would overflow the right edge,
    // slide it left so its right edge sits inside the viewport.
    const docWidth = doc.documentElement?.clientWidth ?? 0;
    if (docWidth > 0) {
      const menuRect = m.getBoundingClientRect();
      if (menuRect.right > docWidth - 4) {
        const adjustedLeft = Math.max(4, docWidth - menuRect.width - 4);
        m.style.left = `${adjustedLeft}px`;
      }
    }

    outsideHandler = (ev: Event) => {
      const target = ev.target as Node;
      if (m.contains(target) || btn.contains(target)) return;
      closeMenu();
    };
    // Defer registration so this same click doesn't immediately close us.
    setTimeout(() => {
      if (outsideHandler) doc.addEventListener("click", outsideHandler, true);
    }, 0);
  };

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuEl) closeMenu();
    else openMenu();
  });

  append(btn);
}

function appendButton(
  doc: Document,
  append: (el: Element) => void,
  id: string,
  label: string,
  title: string,
  onClick: () => void,
): void {
  const btn = doc.createElement("button");
  btn.id = id;
  // 'toolbar-button' is Zotero's reader-toolbar class; without it the React
  // toolbar treats the first click as a focus event and only fires onClick
  // on the second press. Keep it; layer 'ze-tb' for custom theming.
  btn.className = "toolbar-button ze-tb";
  btn.title = title;
  btn.textContent = label;
  btn.type = "button";

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      onClick();
    } catch (err) {
      showStatus(`Error: ${(err as Error).message ?? err}`);
    }
  });

  append(btn);
}

/**
 * Persisted style settings — GLOBAL across all EPUB readers, stored in
 * Zotero.Prefs under `${config.prefsPrefix}.{key}` (extensions.zotero
 * .zotero-epub.{key}). Changes survive Zotero restarts and are shared
 * by every EPUB the user opens.
 */
interface ReaderStyleState {
  fontScale?: number;
  imageScale?: number;
  fontFamily?: string;
  lineHeight?: number;
}

const PREF_FONT_SCALE = `${config.prefsPrefix}.fontScale`;
const PREF_IMAGE_SCALE = `${config.prefsPrefix}.imageScale`;
const PREF_LINE_HEIGHT = `${config.prefsPrefix}.lineHeight`;
const PREF_FONT_FAMILY = `${config.prefsPrefix}.fontFamily`;

function prefGet(key: string): unknown {
  try {
    return (Zotero as any).Prefs.get(key, true);
  } catch {
    return undefined;
  }
}
function prefSet(key: string, value: number | string): void {
  try {
    (Zotero as any).Prefs.set(key, value, true);
  } catch {
    /* ignore */
  }
}
function prefClear(key: string): void {
  try {
    (Zotero as any).Prefs.clear(key, true);
  } catch {
    /* ignore */
  }
}

/**
 * Floats stored as strings — Zotero.Prefs.set routes typeof === 'number'
 * to setIntPref, which truncates 1.2 to 1, making 0.1-step adjustments
 * round-trip to a no-op. Store as string, parse on read.
 */
function prefSetFloat(key: string, value: number): void {
  prefSet(key, String(value));
}
function prefGetFloat(key: string): number | undefined {
  const v = prefGet(key);
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.length > 0) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function getSettings(): ReaderStyleState {
  const fontFamily = prefGet(PREF_FONT_FAMILY);
  return {
    fontScale: prefGetFloat(PREF_FONT_SCALE),
    imageScale: prefGetFloat(PREF_IMAGE_SCALE),
    lineHeight: prefGetFloat(PREF_LINE_HEIGHT),
    fontFamily:
      typeof fontFamily === "string" && fontFamily.length > 0
        ? fontFamily
        : undefined,
  };
}

function clearAllSettings(): void {
  prefClear(PREF_FONT_SCALE);
  prefClear(PREF_IMAGE_SCALE);
  prefClear(PREF_LINE_HEIGHT);
  prefClear(PREF_FONT_FAMILY);
}

/**
 * Per-reader hooks to refresh derived UI (e.g. font dropdown label).
 * Populated when the reader's toolbar is built; called on reset.
 */
const readerLabelRefreshers: Map<number, () => void> = new Map();

/**
 * Adjust EPUB content font size by injecting CSS into _primaryView._iframeDocument.
 * (internalReader.setFontSize was probed earlier and turned out to control the
 * sidebar / chrome font size, not the actual book content.)
 */
function adjustContentFontSize(reader: AnyReader, delta: number): void {
  const handle = getEpubHandle(reader);
  if (!handle?.contentDocument) {
    showStatus("無法取得 EPUB 內容 iframe (contentDocument null)");
    return;
  }

  const settings = getSettings();
  const current = settings.fontScale ?? 1;
  const next =
    Math.round(Math.max(0.5, Math.min(2.5, current + delta)) * 1000) / 1000;
  prefSetFloat(PREF_FONT_SCALE, next);

  const count = applyStyles(handle.contentDocument, getSettings());
  showStatus(
    `字體 ${current.toFixed(3)} → ${next.toFixed(3)} (注入到 ${count} 個文件)`,
  );
}

function adjustImageScale(reader: AnyReader, delta: number): void {
  const handle = getEpubHandle(reader);
  if (!handle?.contentDocument) {
    showStatus("無法取得 EPUB 內容 iframe (contentDocument null)");
    return;
  }
  const settings = getSettings();
  const current = settings.imageScale ?? 1;
  const next =
    Math.round(Math.max(0.3, Math.min(3.0, current + delta)) * 1000) / 1000;
  prefSetFloat(PREF_IMAGE_SCALE, next);

  const count = applyStyles(handle.contentDocument, getSettings());
  showStatus(
    `圖片 ${current.toFixed(2)} → ${next.toFixed(2)} (注入到 ${count} 個文件)`,
  );
}

function adjustLineHeight(reader: AnyReader, delta: number): void {
  const handle = getEpubHandle(reader);
  if (!handle?.contentDocument) {
    showStatus("無法取得 EPUB 內容 iframe (contentDocument null)");
    return;
  }
  const settings = getSettings();
  const current = settings.lineHeight ?? 1.6;
  const next =
    Math.round(Math.max(1.0, Math.min(2.5, current + delta)) * 100) / 100;
  prefSetFloat(PREF_LINE_HEIGHT, next);

  const cssCount = applyStyles(handle.contentDocument, getSettings());
  const inlineCount = applyInlineLineHeightRecursive(
    handle.contentDocument,
    String(next),
  );
  const computed = sampleComputedLineHeight(handle.contentDocument);
  showStatus(
    `行距 ${current.toFixed(2)} → ${next.toFixed(2)} ` +
      `(CSS:${cssCount}, inline:${inlineCount}, computed=${computed})`,
  );
}

function applyInlineLineHeightRecursive(doc: Document, lh: string): number {
  let count = 0;
  try {
    const root = doc.documentElement as HTMLElement | null;
    root?.style.setProperty("line-height", lh, "important");
    const body = doc.body as HTMLElement | null;
    body?.style.setProperty("line-height", lh, "important");

    const all = doc.body?.querySelectorAll("*") ?? [];
    all.forEach((el: Element) => {
      const tag = el.tagName;
      if (
        tag === "STYLE" ||
        tag === "SCRIPT" ||
        tag === "META" ||
        tag === "LINK" ||
        tag === "HEAD"
      ) {
        return;
      }
      try {
        (el as HTMLElement).style.setProperty("line-height", lh, "important");
        count++;
      } catch {
        /* element doesn't accept inline style */
      }
    });
  } catch {
    /* doc inaccessible */
  }
  try {
    const iframes = doc.querySelectorAll("iframe");
    iframes.forEach((iframe: Element) => {
      try {
        const sub = (iframe as HTMLIFrameElement).contentDocument;
        if (sub) count += applyInlineLineHeightRecursive(sub, lh);
      } catch {
        /* cross-origin */
      }
    });
  } catch {
    /* skip */
  }
  return count;
}

function removeInlinePropertyRecursive(doc: Document, prop: string): number {
  let count = 0;
  try {
    const root = doc.documentElement as HTMLElement | null;
    root?.style?.removeProperty(prop);
    const body = doc.body as HTMLElement | null;
    body?.style?.removeProperty(prop);

    const all = doc.body?.querySelectorAll("*") ?? [];
    all.forEach((el: Element) => {
      try {
        (el as HTMLElement).style.removeProperty(prop);
        count++;
      } catch {
        /* skip */
      }
    });
  } catch {
    /* skip */
  }
  try {
    const iframes = doc.querySelectorAll("iframe");
    iframes.forEach((iframe: Element) => {
      try {
        const sub = (iframe as HTMLIFrameElement).contentDocument;
        if (sub) count += removeInlinePropertyRecursive(sub, prop);
      } catch {
        /* skip */
      }
    });
  } catch {
    /* skip */
  }
  return count;
}

/**
 * Reset everything our plugin can touch back to the reader's defaults:
 *   - Clear injected CSS (font-size, line-height, font-family)
 *   - Strip inline 'line-height' that we forced earlier
 *   - flowMode → "paginated", spreadMode → 0
 *   - Refresh font dropdown label so it shows the default again
 */
function resetAllSettings(reader: AnyReader): void {
  const handle = getEpubHandle(reader);
  if (!handle) {
    showStatus("不是 EPUB reader");
    return;
  }
  const itemID = reader.itemID ?? -1;

  // 1. Wipe global persisted settings.
  clearAllSettings();

  let inlineCleared = 0;
  if (handle.contentDocument) {
    // 2. Wipe the injected stylesheet (buildCss({}) returns "").
    applyStyles(handle.contentDocument, {});
    // 3. Remove the inline line-height we forced into every element.
    inlineCleared = removeInlinePropertyRecursive(
      handle.contentDocument,
      "line-height",
    );
  }

  // 4. Reset Zotero-native modes back to single-page paginated default.
  const r: any = handle.internalReader;
  let flowPath = "skip";
  let spreadPath = "skip";
  if (r) {
    flowPath = applyState(r, "flowMode", "paginated");
    spreadPath = applyState(r, "spreadMode", 0);
  }

  // 5. Refresh font dropdown label so it shows the default again.
  readerLabelRefreshers.get(itemID)?.();

  showStatus(
    `已重置全域設定 (inline 清除:${inlineCleared}, ` +
      `flowMode:${flowPath}, spreadMode:${spreadPath})`,
  );
}

function sampleComputedLineHeight(doc: Document): string {
  try {
    // Cast through any to bypass strict null narrowing across try/catch.
    // Real null cases are caught by the surrounding try/catch.
    const win = doc.defaultView as any;
    const el = doc.querySelector("p, div, body") as any;
    if (!win || !el) return "n/a";
    return (win.getComputedStyle(el)?.lineHeight as string) || "n/a";
  } catch {
    return "err";
  }
}

function setContentFontFamily(reader: AnyReader, family: string): void {
  const handle = getEpubHandle(reader);
  if (!handle?.contentDocument) {
    showStatus("無法取得 EPUB 內容 iframe (contentDocument null)");
    return;
  }
  if (family) prefSet(PREF_FONT_FAMILY, family);
  else prefClear(PREF_FONT_FAMILY);

  const count = applyStyles(handle.contentDocument, getSettings());
  const label = FONT_OPTIONS.find((o) => o[0] === family)?.[1] ?? "預設";
  showStatus(`字型 → ${label} (${count} 個文件)`);
}

const STYLE_ID = "ze-content-style";

function buildCss(state: ReaderStyleState): string {
  const parts: string[] = [];

  // Font size — em-based on root only. Behavior is best-effort:
  // EPUBs whose stylesheets use em/rem typography get scaled via
  // inheritance; chapters with fixed-px font-size don't react.
  // (User accepted that trade-off; image scaling is now a separate
  // independent control via PREF_IMAGE_SCALE.)
  if (state.fontScale != null) {
    parts.push(`html { font-size: ${state.fontScale}em !important; }`);
  }

  // Image size — independent control. Layout-aware 'zoom' so figures
  // reflow surrounding content instead of overlapping.
  if (state.imageScale != null) {
    parts.push(
      `html body img, html body svg, html body video, ` +
        `html body picture, html body canvas { ` +
        `zoom: ${state.imageScale} !important; }`,
    );
  }

  // Line height: unitless multiplier — safe to cascade to all descendants
  // via 'html body *' (specificity 0,0,3) so EPUB stylesheets that target
  // '.chapter p' (0,1,1) still lose against our !important.
  if (state.lineHeight != null) {
    parts.push(
      `html, html body, html body * { line-height: ${state.lineHeight} !important; }`,
    );
  } else if (state.fontScale != null) {
    parts.push(
      `html, html body, html body * { line-height: 1.6 !important; }`,
    );
  }

  // Font family: cascade everywhere too — same specificity rationale.
  if (state.fontFamily) {
    parts.push(
      `html body, html body * { font-family: ${state.fontFamily} !important; }`,
    );
  }
  return parts.join("\n");
}

function applyStyles(doc: Document, state: ReaderStyleState): number {
  return injectStyleRecursive(doc, buildCss(state));
}

function injectStyleRecursive(doc: Document, css: string): number {
  let count = 0;
  try {
    let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = STYLE_ID;
      doc.head?.appendChild(style);
    }
    style.textContent = css;
    count++;
  } catch {
    /* skip this doc */
  }
  try {
    const iframes = doc.querySelectorAll("iframe");
    iframes.forEach((iframe: Element) => {
      try {
        const sub = (iframe as HTMLIFrameElement).contentDocument;
        if (sub) count += injectStyleRecursive(sub, css);
      } catch {
        /* cross-origin or detached */
      }
    });
  } catch {
    /* skip */
  }
  return count;
}

/**
 * Toggle EPUB flow mode between paginated and scrolled.
 * (scrollMode is for PDFs; EPUB uses flowMode = "paginated" | "scrolled".)
 */
function toggleFlowMode(reader: AnyReader): void {
  const handle = getEpubHandle(reader);
  if (!handle) {
    showStatus("不是 EPUB reader");
    return;
  }
  const r: any = handle.internalReader;
  const before = r.flowMode;
  const target = before === "paginated" ? "scrolled" : "paginated";

  const path = applyState(r, "flowMode", target);
  const after = r.flowMode;
  showStatus(`flowMode "${before}" → "${after}" (${path})`);
}

/**
 * Toggle spreadMode between 0 and 1 (single ↔ double-page).
 * Earlier cycle through 0/1/2 failed past 1 — Zotero may only support 0/1.
 */
function toggleSpreadMode(reader: AnyReader): void {
  const handle = getEpubHandle(reader);
  if (!handle) {
    showStatus("不是 EPUB reader");
    return;
  }
  const r: any = handle.internalReader;
  const before = r.spreadMode;
  const target =
    typeof before === "number" ? (before === 0 ? 1 : 0) : !before;

  const path = applyState(r, "spreadMode", target);
  const after = r.spreadMode;
  showStatus(
    `spreadMode ${JSON.stringify(before)} → ${JSON.stringify(after)} (${path})`,
  );
}

/**
 * Try three known patterns to write a state field. Returns the path that
 * actually worked ("setter" / "setX()" / "_updateState" / "no-op").
 */
function applyState(reader: any, field: string, value: any): string {
  const before = reader[field];

  try {
    reader[field] = value;
    if (reader[field] !== before) return "setter";
  } catch {
    /* fall through */
  }

  const setterName = `set${field[0].toUpperCase()}${field.slice(1)}`;
  if (typeof reader[setterName] === "function") {
    try {
      reader[setterName](value);
      if (reader[field] !== before) return setterName + "()";
    } catch {
      /* fall through */
    }
  }

  if (typeof reader._updateState === "function") {
    try {
      reader._updateState({ [field]: value });
      if (reader[field] !== before) return "_updateState";
    } catch {
      /* fall through */
    }
  }

  return "no-op";
}

function showStatus(msg: string): void {
  ztoolkit.log(`[${config.addonRef}] ${msg}`);
  try {
    new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({ text: msg, type: "default" })
      .show();
  } catch {
    /* progress window best-effort */
  }
}
