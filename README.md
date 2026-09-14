# Split Easy

目前線上版本：**v1.4.0 — 整張電子發票辨識**

線上網址：https://dreamwriter-h.github.io/p-split1/

## 本版重點

- 臺灣電子發票改成拍攝完整發票，自動尋找左右兩個 QR Code。
- 照片只在手機瀏覽器本機分區、放大及強化對比，不會上傳。
- 若只辨識到其中一碼，才引導補拍單一 QR 特寫。
- 已移除難以理解的「手動貼上 QR 文字」欄位。
- 聚餐混合分攤、全員切換，以及旅遊分日記帳功能均保留。
- 已移除 Gemini 與使用者 API Key 功能。

## 部署

本專案目前由 GitHub Pages 發布 `main` 分支根目錄的靜態檔案。

> Firebase 共編功能仍需搭配正式安全規則；目前部署版應視為測試階段。

詳細變更請參閱 [VERSION_HISTORY.md](./VERSION_HISTORY.md)。
