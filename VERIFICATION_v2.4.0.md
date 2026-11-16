# v2.4.0 發布驗證

日期：2026-11-16。版本 2.4.0；build v2.4.0-prod-r1。

## 功能與驗證

- 帳單 OCR 分行預覽與批次新增、聚餐整筆匯入旅遊、兩模式結算明細及移除下載圖片已由使用者驗收。
- 完整 Babel 編譯通過；既有計算／共編 14 組、聚餐匯入 9 組檢查通過。
- 公司電腦以網站 Google 登入執行 cloud-r3，六項全數通過：雲端建立存檔、跨專案匯入與交易獨立回讀、防止重複匯入、兩次並行呼叫只新增一筆、真實權限拒絕時雙方不變、修改後立即匯入先同步。
- 實際匯入 638 元，個人負擔 182／182／258／16／0；修改後立即匯入為 649 元。
- 測試只操作兩個精確白名單專案，回報私人專案讀取 0；6 份測試文件與索引均清理完成。
- 並行測試使用同一登入者的兩次呼叫；尚未涵蓋兩個不同帳號／裝置共編或所有手機瀏覽器。
- 正式候選僅由已驗收來源更換正式版號及兩個新模組快取標籤；完整編譯再次通過，沒有雲端測試 hook。

## 發布範圍

正式根目錄採用 index.html 與五支 JS，沿用 spliteasy-v2-2-prod 及 schema 2.2.0；Rules 不變，不重部署 Firebase，不遷移或重設資料。

- index.html：234994 bytes；Git blob 38061bee47757e597ee12c600cd7786363e553c2
- invoice-image-scanner.js：22299 bytes；Git blob 434c6f13528a0034d678f3a453d07259431f4fb9
- invoice-qr-parser.js：4164 bytes；Git blob 3b34b42f4966a6af6afb75391d5fd961c53b92c2
- receipt-ocr.js：11225 bytes；Git blob 6096abfd07f6a3df39a926f203aa36ea26d478e0
- receipt-item-parser.js：3477 bytes；Git blob c8aee1932b5b1a2f31e8559f206e8ee0358f610e
- dining-trip-import.js：4524 bytes；Git blob 7b404f8a2c3d9dd560cd2b90f6af53329d524fba
- firestore.rules：5197 bytes；Git blob ba75d243d9a143661c083bd23e94d7020b2d4ecb

網址維持 https://dreamwriter-h.github.io/p-split1/ 。合併後另核對 Pages workflow、遠端 blob、實際頁面版號、模組載入及瀏覽器錯誤。

## 舊版與回復

更新後請關閉舊分頁再開啟原網址。備份分支 backup-v2.3.1-before-v2.4.0-20261116 保留更新前程式；舊版不認得新的固定個人分攤欄位，若已有新匯入資料，須先保留資料再判斷回復方式。
