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
    ["ze-font-minus", "A−", "縮小書本內文字體", () => adjustContentFontSize(reader, -0.1)],
    ["ze-font-plus", "A+", "放大書本內文字體", () => adjustContentFontSize(reader, +0.1)],
    ["ze-flow-toggle", "⇅", "切換捲動 / 翻頁模式 (flowMode)", () => toggleFlowMode(reader)],
    ["ze-spread-toggle", "▤", "切換單頁 / 雙頁模式 (spreadMode)", () => toggleSpreadMode(reader)],
  ];

  for (const [id, label, title, onClick] of buttons) {
    if (doc.getElementById(id)) continue;
    appendButton(doc, append, id, label, title, onClick);
  }

  if (!doc.getElementById("ze-font-family-btn")) {
    appendFontFamilyMenu(doc, append, reader);
  }

  ztoolkit.log(
    `[${config.addonRef}] toolbar attached for EPUB itemID=${reader.itemID}`,
  );
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
  btn.className = "toolbar-button ze-tb";
  btn.title = "更換字型";
  btn.type = "button";

  const labelOf = (value: string) =>
    FONT_OPTIONS.find((o) => o[0] === value)?.[1] ?? "預設";
  const refreshLabel = () => {
    const cur = getReaderState(reader.itemID).fontFamily ?? "";
    btn.textContent = "字型 ▾";
    btn.title = `更換字型 (目前: ${labelOf(cur)})`;
  };
  refreshLabel();

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

    const currentValue = getReaderState(reader.itemID).fontFamily ?? "";
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
 * Per-reader styling state (keyed by itemID). Holds the values our CSS
 * injection should reflect; updates here trigger a single style rewrite,
 * so font-size and font-family won't fight over the same <style> tag.
 */
interface ReaderStyleState {
  fontScale?: number;
  fontFamily?: string;
}
const readerStyles: Map<number, ReaderStyleState> = new Map();

function getReaderState(itemID: number | undefined): ReaderStyleState {
  const key = itemID ?? -1;
  let s = readerStyles.get(key);
  if (!s) {
    s = {};
    readerStyles.set(key, s);
  }
  return s;
}

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

  const state = getReaderState(reader.itemID);
  const current = state.fontScale ?? 1;
  const next =
    Math.round(Math.max(0.5, Math.min(2.5, current + delta)) * 100) / 100;
  state.fontScale = next;

  const count = applyStyles(handle.contentDocument, state);
  showStatus(
    `字體 ${current.toFixed(2)} → ${next.toFixed(2)} (注入到 ${count} 個文件)`,
  );
}

function setContentFontFamily(reader: AnyReader, family: string): void {
  const handle = getEpubHandle(reader);
  if (!handle?.contentDocument) {
    showStatus("無法取得 EPUB 內容 iframe (contentDocument null)");
    return;
  }
  const state = getReaderState(reader.itemID);
  state.fontFamily = family || undefined;

  const count = applyStyles(handle.contentDocument, state);
  const label = FONT_OPTIONS.find((o) => o[0] === family)?.[1] ?? "預設";
  showStatus(`字型 → ${label} (${count} 個文件)`);
}

const STYLE_ID = "ze-content-style";

function buildCss(state: ReaderStyleState): string {
  const parts: string[] = [];
  if (state.fontScale != null) {
    parts.push(`html { font-size: ${state.fontScale}em !important; }`);
    parts.push(
      `body, p, div, span, li, td, th, blockquote { ` +
        `font-size: ${state.fontScale}em !important; ` +
        `line-height: 1.6 !important; }`,
    );
  }
  if (state.fontFamily) {
    parts.push(
      `body, p, div, span, li, td, th, blockquote, ` +
        `h1, h2, h3, h4, h5, h6 { ` +
        `font-family: ${state.fontFamily} !important; }`,
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
