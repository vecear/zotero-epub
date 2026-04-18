/**
 * EPUB reader integration for Zotero 9.
 *
 * Strategy (see findings.md §6):
 *   1. Register renderToolbar listener — fires when a reader finishes rendering,
 *      acts as the "reader ready" signal (Zotero has no dedicated event).
 *   2. Filter by reader.type === "epub".
 *   3. Reach into reader._internalReader (EPUBView) and reader._iframeWindow
 *      for epub.js rendition/book access. These are private but stable enough
 *      across Zotero 9.x — guard at runtime and centralize access here.
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
  iframeWindow: Window | null;
  document: Document | null;
}

export function getEpubHandle(reader: AnyReader): EpubHandle | null {
  if (!reader || reader.type !== "epub") return null;
  const internalReader = reader._internalReader ?? null;
  const iframeWindow = reader._iframeWindow ?? null;
  const document = iframeWindow?.document ?? null;
  return { reader, internalReader, iframeWindow, document };
}

export function registerEpubHooks(): void {
  const Reader = (Zotero as any).Reader;
  if (!Reader || typeof Reader.registerEventListener !== "function") {
    ztoolkit.log(
      `[${config.addonRef}] Zotero.Reader.registerEventListener not found — aborting hook registration`,
    );
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

  const btnId = `${config.addonRef}-toolbar-btn`;
  if (doc.getElementById(btnId)) return;

  const btn = doc.createElement("button");
  btn.id = btnId;
  btn.className = "toolbar-button";
  btn.title = "Zotero EPUB Reader — probe";
  btn.textContent = "📖";
  btn.style.cssText =
    "background:none;border:none;cursor:pointer;font-size:16px;padding:4px 8px;";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    probeEpubInternals(reader);
  });
  append(btn);

  ztoolkit.log(
    `[${config.addonRef}] toolbar button attached for EPUB reader`,
    reader.itemID,
  );
}

/**
 * Runtime probe — dumps EPUB reader internals so we can decide the
 * rendition/book/locations access path in later milestones.
 * Output goes to Zotero's debug log (Help → Debug Output Logging).
 */
function probeEpubInternals(reader: AnyReader): void {
  const handle = getEpubHandle(reader);
  if (!handle) {
    ztoolkit.log(`[${config.addonRef}] probe: not an EPUB reader`);
    return;
  }

  const { internalReader, iframeWindow } = handle;

  const internalKeys = internalReader
    ? Object.keys(internalReader).slice(0, 80)
    : [];
  ztoolkit.log(
    `[${config.addonRef}] _internalReader keys:`,
    JSON.stringify(internalKeys),
  );

  const candidates = [
    "_rendition",
    "rendition",
    "_book",
    "book",
    "_view",
    "view",
    "_views",
    "views",
    "flow",
    "_flow",
    "sectionRenderer",
    "_sectionRenderer",
    "_epub",
    "epub",
  ];
  for (const k of candidates) {
    const val = internalReader?.[k];
    if (val !== undefined) {
      ztoolkit.log(
        `[${config.addonRef}] internalReader.${k}: type=${typeof val}, ctor=${val?.constructor?.name}`,
      );
    }
  }

  if (iframeWindow) {
    const win = iframeWindow as any;
    const winKeys = Object.keys(win).filter(
      (k) => !k.startsWith("chrome") && !k.startsWith("_"),
    );
    ztoolkit.log(
      `[${config.addonRef}] iframeWindow keys (${winKeys.length}):`,
      JSON.stringify(winKeys.slice(0, 60)),
    );
    for (const k of ["ePub", "EPub", "epub", "rendition", "book", "ePubView"]) {
      if (win[k] !== undefined) {
        ztoolkit.log(
          `[${config.addonRef}] iframeWindow.${k}: ctor=${win[k]?.constructor?.name}`,
        );
      }
    }
  }

  try {
    (Zotero as any)
      .getMainWindow()
      .alert(
        `Zotero EPUB Reader probe\n\n` +
          `itemID: ${reader.itemID}\n` +
          `type: ${reader.type}\n` +
          `internalReader: ${!!internalReader} (${internalReader?.constructor?.name ?? "n/a"})\n` +
          `iframeWindow: ${!!iframeWindow}\n\n` +
          `Full dump: Zotero → Help → Debug Output Logging → View Output`,
      );
  } catch {
    /* alert is best-effort */
  }
}
