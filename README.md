# Zotero EPUB Reader

[![zotero target version](https://img.shields.io/badge/Zotero-9-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](LICENSE)

為 Zotero 9 打造 PDF 式的 EPUB 閱讀體驗：虛擬固定分頁、精細字體與版面控制、雙頁模式，以及與 Zotero annotation 整合的書籤系統。

## Features

- **PDF-like 分頁**：虛擬頁碼（總頁數 / 跳頁 / 頁邊界視覺），支援連續捲動與一次一頁兩種模式切換。
- **單頁 / 雙頁 / 書本模式**：寬螢幕可並排顯示。
- **字體與版面控制（Global）**：字級、行距、邊距、字型、欄寬、對齊方式。
- **繁中優化**：斷行規則、標點擠壓。
- **書籤系統**：寄生在 Zotero annotation，享有原生同步。側邊 TOC + 使用者書籤樹。
- **全書搜尋**、**EPUB 內外超連結**。

## Installation

> 尚未發佈，開發中。完成後可從 [Releases](https://github.com/vecear/zotero-epub/releases) 下載 `.xpi`。

1. 下載最新的 `zotero-epub.xpi`
2. Zotero 9 → 工具（Tools） → 外掛（Add-ons）
3. 齒輪選單 → Install Add-on From File → 選 `.xpi`
4. 重啟 Zotero

## Development

### Prerequisites

- Node.js 22+（本專案使用 24.12）
- Zotero 9（[下載](https://www.zotero.org/download/)）
- 一個專用的 Zotero 開發 profile

### Setup

```bash
git clone https://github.com/vecear/zotero-epub.git
cd zotero-epub
npm install
cp .env.example .env
# 編輯 .env 填入 Zotero 9 binary 路徑與 profile 路徑
```

### Develop

```bash
npm start        # 啟動 Zotero 並 hot reload
npm run build    # 打包 .xpi
npm run lint:fix # Prettier + ESLint
npm test         # 單元測試
```

## Architecture

本外掛採 bootstrap plugin 模式，掛入 Zotero 內建 reader：

- **Reader hooks**：`Zotero.Reader.registerEventListener` 監聽 EPUB reader 開啟事件。
- **epub.js hooks**：注入 `rendition.hooks.content` 套用 CSS、`book.locations.generate()` 預計算分頁。
- **設定儲存**：`Zotero.Prefs`（`extensions.zotero.zoteroepub.*`），全域共用。
- **書籤資料**：Zotero 原生 annotation API（自訂 type 區分一般標註與書籤）。

詳見 [`task_plan.md`](./task_plan.md)。

## Roadmap

- [ ] M1 專案骨架
- [ ] M2 Zotero 9 reader hook 探路
- [ ] M3 虛擬分頁系統
- [ ] M4 字體與版面設定面板
- [ ] M5 書籤系統
- [ ] M6 全書搜尋 + 測試打磨 + 發布

## License

AGPL-3.0-or-later。基於 [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)。

## Acknowledgments

- [Zotero](https://www.zotero.org/)
- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
- [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit)
- [zotero/epub.js](https://github.com/zotero/epub.js)
