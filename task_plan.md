# zotero-epub 專案規劃

**目標**：Zotero 9 外掛，讓 EPUB 閱讀體驗接近 PDF。
**路線**：擴充內建 reader（bootstrap plugin + `Zotero.Reader` hook + epub.js hooks），不自寫 tab。

---

## 「PDF-like 體驗」功能拆解（待使用者確認）

下列為我對「類似 PDF 閱讀體驗」的具體假設，請 review。打 ✅ 的是我預設會做，打 ❓ 的是需要你決定的。

### A. 分頁（Pagination）
- ✅ **虛擬頁碼系統**：用 `book.locations.generate(N chars per page)` 預先切頁，產生穩定頁碼
- ✅ **當前頁 / 總頁數顯示**（如 `42 / 317`）
- ✅ **跳頁輸入框**（輸入頁碼直接跳轉）
- ✅ **捲動 + 翻頁兩種模式皆做可切換**（決定：c）
- ✅ **單頁 / 雙頁 / 書本模式**（決定：要做）

### B. 字體與版面（Typography & Layout）
- ✅ **字級調整**（滑桿或 +/− 按鈕）
- ✅ **行距調整**
- ✅ **頁面邊距調整**
- ✅ **字型選擇**（系統字型清單 + 內建 serif/sans/mono 預設）
- ✅ **欄寬限制**（max-width，避免超寬螢幕文字過長）
- ✅ **對齊方式**（左對齊 / 兩端對齊）
- ✅ **中文字型優化**（繁中斷行、標點擠壓；豎排暫不做）
- ✅ **設定為 GLOBAL**（決定）

### C. 書籤（Bookmarks）
- ✅ **側邊書籤面板**（類 PDF 左側樹狀 outline）
- ✅ **使用者自訂書籤**（在當前位置加書籤 + 命名 + 刪除 + 跳轉）
- ✅ **書籤持久化**（存在 Zotero 資料庫或外掛 preferences）
- ✅ **書籤寄生在 Zotero annotation**（決定：享有同步，可能用自訂 annotation type 或 color tag 區分）
- ✅ **EPUB 內建 TOC（目錄）側邊顯示**（epub.js 原生支援，只需渲染 UI）

### D. 超連結（Hyperlinks）
- ✅ **EPUB 內部跨章連結**（epub.js 原生支援，確認運作即可）
- ✅ **外部 URL 點擊開啟瀏覽器**
- 🟡 **連結預覽 hover tooltip**（暫緩，打磨期再看）

### E. 其他 PDF-like 功能
- ❌ **縮圖側邊欄**（不做，成本高）
- ✅ **全書搜尋**（epub.js search API）
- 🟡 **複製文字 / 選取反白**（確認內建，缺再補）
- 🟡 **閱讀進度持久化 + 同步**（確認內建）

---

## Milestones（待 A~E 確認後調整）

### M1: 專案骨架（半天）
- Clone `windingwind/zotero-plugin-template`（bootstrap branch）
- 改 `package.json` / `manifest` 為 zotero-epub
- 跑通 hot reload，在 Zotero 9 beta/release 裝起來
- Push 空骨架到 GitHub public repo

### M2: Reader hook 探路（1 天）
- 找出 Zotero 9 reader 暴露的 API（`Zotero.Reader.registerEventListener`? `_iframeWindow`?）
- 能從 plugin 注入 CSS/JS 到 EPUB iframe
- 能抓到 epub.js `rendition` 物件並呼叫 hook

### M3: 虛擬分頁（2 天）
- `book.locations.generate()` 在背景跑
- UI: 頁碼顯示、跳頁、頁邊界視覺
- 翻頁 vs 捲動模式切換

### M4: 字體與版面面板（2 天）
- 側邊設定面板 UI
- 注入 CSS 到 epub.js content
- 設定持久化（prefs）
- 繁中優化

### M5: 書籤系統（2 天）
- 側邊書籤面板（TOC + 使用者書籤）
- 加 / 刪 / 跳轉
- 持久化（與 Zotero annotation 整合還是外掛獨立？）

### M6: 測試與打磨（2 天）
- E2E：至少 3 本不同 EPUB（純文字、含圖、含複雜 CSS）
- 繁中 EPUB 測試
- 打包 `.xpi` release

---

## 開放風險

1. **Zotero 9 plugin API 未必穩定**：9.0 剛發佈一週，API 可能還在調整。需確認 hook 點。
2. **epub.js 在 Zotero fork 可能被改過**：直接用上游 API 可能失效，要讀 `zotero/epub.js` 原始碼。
3. **與內建 Appearance panel 衝突**：我們的設定面板 vs 內建主題誰優先？UX 要想清楚。
4. **annotation / 書籤的資料同步**：若存在 plugin 自己的儲存，Zotero 同步功能會忽略它。
