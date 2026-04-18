# Zotero EPUB Reader

[![zotero target version](https://img.shields.io/badge/Zotero-9-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](LICENSE)

為 Zotero 9 打造接近 PDF 的 EPUB 閱讀體驗：精細字體 / 行距 / 字型控制、捲動 ↔ 翻頁切換、單頁 / 雙頁模式，全部設定 GLOBAL 持久化。

## ✨ Features

| Toolbar 按鈕    | 功能                | 說明                                                                           |
| --------------- | ------------------- | ------------------------------------------------------------------------------ |
| **A−** / **A+** | 縮小 / 放大書內字體 | 範圍 0.5×–2.5×（步進 0.1×）                                                    |
| **≡−** / **≡+** | 縮小 / 放大行距     | 範圍 1.0–2.5（步進 0.1）                                                       |
| **⇅**           | 切換捲動 / 翻頁模式 | Zotero 原生 `flowMode`                                                         |
| **▤**           | 切換單頁 / 雙頁模式 | Zotero 原生 `spreadMode`                                                       |
| **字型 ▾**      | 字型下拉選單        | 11 個預設：微軟正黑體、新細明體、標楷體、思源黑/宋體、Georgia、Times、Arial 等 |
| **↺**           | 重置全部設定        | 一鍵回到 Zotero 預設                                                           |

所有字體 / 行距 / 字型設定都是 **GLOBAL 持久化**：透過 `Zotero.Prefs` 儲存，重啟 Zotero 與打開新書時自動套用。

## 🔖 書籤工作流

**Zotero 9 內建 annotation 系統已完整涵蓋書籤需求**，本外掛不另行重做。建議工作流：

1. 在 EPUB reader 中選取段落 → 點 **Highlight** 工具反白
2. 對該 highlight 加 tag `bookmark` 或自訂顏色當書籤標識
3. 在 Zotero 主庫的 attachment 下可看到所有 annotation（享有 Zotero 同步）
4. 點 annotation 即跳回 EPUB 對應位置
5. 用 tag 篩選快速找到所有書籤

這個方式比另寫獨立書籤系統更有優勢：享有原生雲端同步、跨檔案搜尋、Zotero Citation 整合。

## 📦 Installation

從 [GitHub Releases](https://github.com/vecear/zotero-epub/releases) 下載最新 `zotero-epub.xpi`：

1. Zotero 9 → 工具（Tools）→ 外掛（Add-ons）
2. 齒輪選單 → **Install Add-on From File…** → 選下載的 `.xpi`
3. 重啟 Zotero
4. 開任一 EPUB → toolbar 應出現 7 個新按鈕

## 🛠 Development

### Prerequisites

- Node.js 22+
- Zotero 9（[下載](https://www.zotero.org/download/)）
- 一個專屬 dev profile（強烈建議；用 `zotero.exe -p` 建立）

### Setup

```bash
git clone https://github.com/vecear/zotero-epub.git
cd zotero-epub
npm install
cp .env.example .env
# 編輯 .env 填入 Zotero binary 路徑與 dev profile 路徑
```

### Develop

```bash
npm start        # 啟動 Zotero 並 hot reload
npm run build    # 打包 .xpi 到 .scaffold/build/
npm run lint:fix # Prettier + ESLint
npm test         # 單元測試
```

## 🏗 Architecture

Bootstrap plugin 模式，掛入 Zotero 9 內建 reader：

| 層             | 機制                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| Plugin 入口    | `Zotero.Reader.registerEventListener("renderToolbar", ...)`            |
| EPUB view 存取 | `reader._internalReader._primaryView` (epub-view.ts EPUBView instance) |
| 原生 API 呼叫  | `internalReader.setFontSize` / `flowMode` / `spreadMode` / `navigate*` |
| CSS 注入       | `_primaryView._iframeDocument` + 遞迴 nested iframes                   |
| 行距 force     | inline `setProperty(..., 'important')` (壓過 EPUB 自帶 stylesheet)     |
| 設定持久化     | `Zotero.Prefs` (`extensions.zotero.zotero-epub.*`) — GLOBAL            |

詳細探路結果見 [`findings.md`](./findings.md)。

## ✅ Roadmap

- [x] M1 專案骨架（zotero-plugin-template + GitHub repo）
- [x] M2 Zotero 9 reader hook 探路（findings.md）
- [x] M3 Toolbar UI（字體 / 行距 / 模式 / 字型 / 重置）
- [x] M4 GLOBAL 設定持久化（Zotero.Prefs）
- [x] M5 書籤（用 Zotero 內建 annotation，文檔指引）
- [x] M6 全書搜尋（用 Zotero 內建 search toolbar，無需重做）+ release

## 已知限制

- **flowMode / spreadMode 不持久化**：Zotero 9 reader 自身可能 cache 此狀態，重複設可能衝突，故只支援即時切換。
- **font-size 用 em 單位**：對 EPUB 內 px-based 字體的元素效果有限。
- **EPUB 內若用 inline `!important` 字型設定**：會壓過外掛 CSS，需使用內建 highlight 評論而非外掛字型切換。

## License

AGPL-3.0-or-later。基於 [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)。

## Acknowledgments

- [Zotero](https://www.zotero.org/) — Open-source reference manager
- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) — bootstrap & hot reload
- [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) — UI helpers
- [zotero/reader](https://github.com/zotero/reader) — PDF/EPUB reader 原始碼參考
- [zotero/epub.js](https://github.com/zotero/epub.js) — EPUB 渲染引擎
