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

  const containerId = `${config.addonRef}-toolbar-group`;
  if (doc.getElementById(containerId)) return;

  const container = doc.createElement("div");
  container.id = containerId;
  container.style.cssText =
    "display:inline-flex;gap:4px;margin-left:8px;align-items:center;";

  appendButton(doc, container, "ze-font-minus", "A−", "縮小字體", () =>
    adjustFontSize(reader, -0.1),
  );
  appendButton(doc, container, "ze-font-plus", "A+", "放大字體", () =>
    adjustFontSize(reader, +0.1),
  );
  appendButton(
    doc,
    container,
    "ze-scroll-toggle",
    "⇅",
    "切換捲動 / 翻頁模式",
    () => toggleScrollMode(reader),
  );
  appendButton(
    doc,
    container,
    "ze-spread-toggle",
    "▤",
    "循環單頁 / 雙頁(odd) / 雙頁(even) 模式",
    () => cycleSpreadMode(reader),
  );

  append(container);
  ztoolkit.log(
    `[${config.addonRef}] toolbar attached for EPUB itemID=${reader.itemID}`,
  );
}

function appendButton(
  doc: Document,
  parent: Element,
  id: string,
  label: string,
  title: string,
  onClick: () => void,
): void {
  const btn = doc.createElement("button");
  btn.id = id;
  btn.title = title;
  btn.textContent = label;
  btn.style.cssText =
    "background:transparent;border:1px solid #888;border-radius:3px;" +
    "padding:2px 8px;cursor:pointer;font-size:13px;min-width:28px;" +
    "color:inherit;font-family:inherit;";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      onClick();
    } catch (err) {
      showStatus(`Error: ${(err as Error).message ?? err}`);
    }
  });
  parent.appendChild(btn);
}

function adjustFontSize(reader: AnyReader, delta: number): void {
  const handle = getEpubHandle(reader);
  if (!handle) {
    showStatus("不是 EPUB reader");
    return;
  }
  const r: any = handle.internalReader;
  if (typeof r.setFontSize !== "function") {
    showStatus("setFontSize API 不可用");
    return;
  }
  const current = Number(r._state?.fontSize) || 1;
  const next =
    Math.round(Math.max(0.5, Math.min(2.5, current + delta)) * 100) / 100;
  r.setFontSize(next);
  showStatus(`字體 ${current.toFixed(2)} → ${next.toFixed(2)}`);
}

/**
 * Toggle scrollMode. We don't yet know whether Zotero 9 exposes a setter,
 * a setScrollMode method, or expects _updateState({...}) — try all three.
 */
function toggleScrollMode(reader: AnyReader): void {
  const handle = getEpubHandle(reader);
  if (!handle) {
    showStatus("不是 EPUB reader");
    return;
  }
  const r: any = handle.internalReader;
  const before = r.scrollMode;
  const target = !before;

  const path = applyState(r, "scrollMode", target);
  const after = r.scrollMode;
  showStatus(`scrollMode ${before} → ${after} (${path})`);
}

/**
 * Cycle spreadMode through 0 → 1 → 2 → 0.
 * (PDF.js convention: 0=single, 1=odd-spreads, 2=even-spreads.)
 */
function cycleSpreadMode(reader: AnyReader): void {
  const handle = getEpubHandle(reader);
  if (!handle) {
    showStatus("不是 EPUB reader");
    return;
  }
  const r: any = handle.internalReader;
  const before = Number(r.spreadMode) || 0;
  const target = (before + 1) % 3;

  const path = applyState(r, "spreadMode", target);
  const after = r.spreadMode;
  showStatus(`spreadMode ${before} → ${after} (${path})`);
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
