# M2 Findings: Zotero 9 Reader Hook 探路

**日期**: 2026-04-18
**結論**: Hook 路徑可行，有三把鑰匙 + 兩個風險。可以進 M3。

---

## 1. Zotero.Reader 公開 API

定義位置：`chrome/content/zotero/xpcom/reader.js` (Zotero main repo)

### Event API

```javascript
Zotero.Reader.registerEventListener(type, handler, pluginID);
Zotero.Reader.unregisterEventListener(type, handler);
```

**可用事件類型**（統一 API，EPUB/PDF/snapshot 共用）：

- `renderToolbar` — toolbar 渲染時 → **當作「reader ready」proxy**
- `renderTextSelectionPopup`
- `renderSidebarAnnotationHeader`
- `createColorContextMenu`
- `createViewContextMenu`
- `createAnnotationContextMenu`
- `createThumbnailContextMenu`
- `createSelectorContextMenu`

**Handler 收到**：`{ reader, doc, params, append }`

- `reader`：Reader instance
- `doc`：DOM document（注入 UI 元素）
- `append`：callback，把元素掛到正確位置

⚠️ **沒有專屬 `readerOpened` / `readerReady` 事件**。要偵測 reader 生命週期，用 `renderToolbar` 或 `Zotero.Notifier.registerObserver(callback, ['tab'])`。

### Reader Discovery

```javascript
Zotero.Reader.getByTabID(tabID); // ReaderTab | undefined
Zotero.Reader.getWindowStates(); // Array<WindowState>
```

---

## 2. Reader Instance 關鍵 Accessor

### 類型判斷

```javascript
reader.type; // "pdf" | "epub" | "snapshot"
reader._type; // 同上（內部）
```

**這是我們判斷「這是 EPUB reader」的入口**。所有 hook handler 都要先 `if (reader.type === "epub")` 分派。

### 取得底層實作與 iframe

```javascript
reader._internalReader; // 底層 reader impl（EPUB 是 EPUBView，PDF 是 PDFView）
reader._iframeWindow; // iframe contentWindow（epub.js rendition 住在這裡）
reader._item; // Zotero attachment item
reader.itemID; // number
```

### Reader 動作

```javascript
reader.navigate(location);
reader.focus();
reader.reload();
reader.setAnnotations(items);
reader.unsetAnnotations(keys);
reader.setContextPaneOpen(open);
reader.setBottomPlaceholderHeight(height);
```

---

## 3. EPUB View 結構

repo: `github.com/zotero/reader`，EPUB 實作在 `src/dom/epub/`：

| 檔案                  | 用途                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `epub-view.ts`        | EPUB view 主類（等同於 reader.\_internalReader for EPUB）           |
| `flow.ts`             | 版面配置流（分頁流 vs 捲動流 → **M3 要改這裡**）                    |
| `section-renderer.ts` | 章節渲染（**M4 字體/版面 CSS 注入點**）                             |
| `cfi.ts`              | EPUB CFI（Canonical Fragment Identifier）處理（分頁跳轉、書籤位置） |
| `find.ts`             | 全書搜尋（**M6 搜尋**）                                             |

**關鍵**：這些檔案**在 Zotero 9 runtime 中以 bundled JS 形式存在**，我們無法直接修改原始碼，但可以：

- 透過 `reader._internalReader` 存取其 public method / property
- 透過 `reader._iframeWindow` 存取 iframe 內的 epub.js instance
- 注入 CSS 到 iframe（經由 `doc.createElement('link')` 或 `iframeWindow.document.head`）

---

## 4. epub.js 整合

Zotero 用 fork 過的 epub.js：`github.com/zotero/epub.js`。
關鍵 hook 點（上游原生，fork 應保留）：

```javascript
// 在 iframe 內取得 book / rendition
const win = reader._iframeWindow;
// epub.js 物件通常掛在 globalThis 或 view instance
// 具體路徑待 runtime 探測（M3 第一步）

rendition.hooks.content((contents) => {
  /* 注入 CSS 到每章節 iframe */
});
rendition.hooks.render((view) => {
  /* 渲染前 hook */
});
book.locations.generate(1024); // 產生虛擬頁碼（M3 核心）
book.locations.percentageFromCfi(cfi);
rendition.display(cfi); // 跳頁
```

⚠️ **Zotero fork 可能改過 API**。M3 第一步要 runtime dump `reader._internalReader` 和 `reader._iframeWindow` 的屬性確認實際形狀。

---

## 5. 相容性證據

**M1 smoke test 已驗證**：

- bootstrap plugin API 在 Zotero 9 相容
- `zotero-plugin-toolkit` v5.1.0-beta.13 運作正常
- `zotero-types` v4.1.0-beta.4 的 type 定義可用
- hot reload pipeline (zotero-plugin-scaffold 0.8.2) 可用

---

## 6. Hook 策略（供 M3 採用）

```typescript
// 1. onStartup 註冊 reader event listener
Zotero.Reader.registerEventListener(
  "renderToolbar",
  (event) => {
    const { reader, doc, append } = event;
    if (reader.type !== "epub") return; // 只管 EPUB

    // 2. 取得 EPUB 底層
    const epubView = reader._internalReader; // EPUBView instance
    const iframeWin = reader._iframeWindow;

    // 3. 注入 UI（分頁器、字體按鈕）到 toolbar
    const btn = doc.createElement("button");
    btn.textContent = "📖 Settings";
    append(btn);

    // 4. 注入 CSS 到 iframe（字體/版面）
    const style = iframeWin.document.createElement("style");
    style.textContent = `body { font-size: var(--ze-font-size); }`;
    iframeWin.document.head.appendChild(style);

    // 5. 取得 epub.js rendition（路徑待 M3 探測）
    // 猜測：epubView._rendition 或 epubView.views._container
    //      或 iframeWin.rendition（全域）
  },
  "zotero-epub@vecear.github.io",
);
```

---

## 7. 開放風險

1. **`_internalReader` / `_iframeWindow` 是私有屬性**：底線前綴表示內部 API，Zotero 升級可能變動。風險等級：中。
   - 緩解：封裝成單一 helper function `getEpubView(reader)`，未來 API 變時只改這裡。

2. **epub.js rendition 取得路徑未驗證**：Zotero fork 可能改過。風險等級：中。
   - 緩解：M3 第一步用 dev tools / console.log 探測實際路徑。

3. **沒有 `readerOpened` 事件**：要用 `renderToolbar` 或 Notifier observer 當 proxy。風險等級：低。
   - 緩解：`renderToolbar` 會在 reader 渲染時觸發，時機足夠。

4. **dual-page mode 需在 flow.ts 層級操作**：內建 flow 可能不支援雙頁。風險等級：高。
   - 緩解：若無法透過 hook 達成，退路是自訂 flow 模式覆蓋 section-renderer CSS（CSS multi-column）。

---

## 8. M3 第一步建議動作

1. 在 `src/hooks.ts` 註冊 `renderToolbar` listener
2. 取得 EPUB reader 時 `console.log(reader._internalReader)` + `console.log(reader._iframeWindow)` dump 全部屬性
3. 確認 rendition / book / locations 的實際存取路徑
4. 寫 `src/modules/epubReader.ts` 封裝 `getEpubView(reader)` helper
5. 加一個 toolbar button 當作 hook 起點，點擊顯示分頁資訊 dialog

---

## 9. Runtime Probe 結果（2026-04-18，Zotero 9）

**重大修正**：不必 hack epub.js，Zotero 9 Reader 已暴露豐富原生 API。

### 9.1 實際物件結構

```
reader (ReaderTab)
├── type: "epub"
├── _iframeWindow: Zotero reader shell (resource://zotero/reader/reader.html)
│                  ↑ 這不是書本內容 iframe！
└── _internalReader: Reader instance (src/common/reader.js)
    ├── _primaryView: EPUBView instance (ctor=epub_view_EPUBView) ★
    │   ├── _container, _iframe, _iframeWindow, _iframeDocument ← 真正的書本 iframe
    │   ├── _annotations, _annotationsByID, _showAnnotations
    │   ├── _theme, _lightTheme, _darkTheme, _colorScheme
    │   ├── _findState
    │   ├── _history
    │   └── initializedPromise
    ├── _secondaryView: EPUBView | null (split view)
    ├── _state: 統一狀態物件
    ├── _focusManager, _keyboardManager, _annotationManager
    ├── _tools
    └── _splitViewContainer, _primaryViewContainer, _secondaryViewContainer
```

### 9.2 原生 API 寶庫（Reader.prototype）

**版面 / 外觀**：

- `setFontSize(size)` — 字體大小
- `setFontFamily(family)` — 字型
- `setHyphenate(bool)` — 斷字
- `setLightTheme(theme)`, `setDarkTheme(theme)`, `setColorScheme(scheme)`
- `setCustomThemes(arr)`

**顯示模式**（我們 M3 的核心，原生支援！）：

- `scrollMode` — getter, 捲動模式
- `flowMode` — getter, 流動模式（PaginatedFlow / ScrollFlow）
- `spreadMode` — getter, **雙頁/單頁模式**
- 對應 setter 用 `_updateState({scrollMode, flowMode, spreadMode})` 或直接賦值（M3 要驗證）

**縮放**：

- `zoomIn`, `zoomOut`, `zoomReset`, `zoomAuto`
- `zoomPageWidth`, `zoomPageHeight`

**導航**：

- `navigate(location)` — location 是 CFI 或 page label
- `navigateBack`, `navigateForward`
- `navigateToFirstPage`, `navigateToLastPage`
- `navigateToPreviousPage`, `navigateToNextPage`
- `navigateToPreviousSection`, `navigateToNextSection`
- `canNavigateToFirstPage` / `canNavigateToNextPage` 等 boolean getter

**註解**（M5 書籤寄生）：

- `setAnnotations(items)`, `unsetAnnotations(keys)`
- `deleteAnnotations`, `convertAnnotations`, `mergeAnnotations`
- `getUnsavedAnnotations`
- `importAnnotationsFromKOReaderMetadata`, `importAnnotationsFromCalibreMetadata`

**搜尋**（M6）：

- `findNext`, `findPrevious`, `toggleFindPopup`

**UI 控制**：

- `toggleSidebar`, `setSidebarView`, `setSidebarWidth`
- `toggleHorizontalSplit`, `toggleVerticalSplit`, `splitType`, `disableSplitView`
- `toggleAppearancePopup`（Zotero 9 內建 Appearance panel，我們可做為整合點）
- `setContextPaneOpen`, `setBottomPlaceholderHeight`
- `focus`, `focusView`, `focusToolbar`
- `freeze`, `unfreeze` — 凍結渲染以利批次改動

**Read Aloud**（Zotero 9 新功能，本專案可忽略）：

- `toggleReadAloudPopup`, `toggleReadAloudPaused`

### 9.3 策略大翻修

**原本想法**：自己用 epub.js rendition.hooks.content 注入 CSS、book.locations.generate 算頁、DOM iframe 手動處理。

**新想法**：直接呼叫 `internalReader.set*()` / `navigate*()` / `toggle*()`，把我們的 plugin 定位為「Zotero 9 Reader 的 UI 擴充層」：

- M3 **顯示模式切換**：包 toolbar 按鈕 → `scrollMode` / `flowMode` / `spreadMode` toggle
- M4 **字體/版面面板**：呼叫 `setFontSize` / `setFontFamily` / `setHyphenate`；CSS 細節可注入到 `_primaryView._iframeDocument`
- M5 **書籤**：用 `setAnnotations` + 自訂 type 區分一般標註與書籤
- M6 **搜尋**：已有 `findNext` / `toggleFindPopup`

**仍要自己做的**：

- 虛擬頁碼 UI（原生有 `navigateToNextPage`，但頁碼顯示可能需要自算）
- 跳頁輸入框（需知 navigate 接受格式）
- 書籤樹側邊面板 UI
- 繁中字型優化 CSS 注入

### 9.4 下一波 MVP（M3 phase 2）

改 probe button：按下去後呼叫 `setFontSize` 和 `scrollMode` toggle，驗證 API 實際行為；確認後寫正式 UI 面板。
