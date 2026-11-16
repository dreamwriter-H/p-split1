# v2.4.1 匯入誤判修正驗證

日期：2026-11-16。版本 2.4.1，build v2.4.1-prod-r1。

使用者回報混合品項聚餐核對成員後，匯入被誤判為「聚餐內容或旅遊成員已變更」。舊版直接序列化原品項；修正版比對時遞迴固定物件欄位順序，仍保留陣列順序與數值，不修改帳目或分攤計算。

- 9 項針對回歸通過：同值不同欄位順序、輸入不變、實際 production callback 舊版重現與新版成功、兩筆聚餐進同一旅遊、重複阻擋、金額／品項負擔人／旅遊成員真的變更仍阻擋。
- 既有 9 組匯入計算檢查通過；完整 Babel 編譯通過，原聚餐計算函式逐字不變。
- 正式 modal 與原匯入 callback 使用模擬排序 map 的本機交易核對：同操作舊 helper 失敗、新 helper 匯入 638 元，個人負擔 182／182／258／16，未參加者 0；既有支出保留。
- 單檔離線 UI、手機及桌面核對通過；HTTP 請求 0、頁面錯誤 0。
- 本次未重新執行真實 Firebase 登入後交易，也未讀寫使用者帳目。前次 cloud-r3 真雲端結果仍保留，但其 request 直接來自伺服器資料，未涵蓋本次補上的畫面與伺服器欄位順序差異；上述本次交易驗證屬 mock。
- 正式版相對已驗收修正版僅更換版本與快取標籤；其餘四支 JS、Rules 及 firebase.json 與 v2.4.0 相同。

## 執行檔

- index.html：Git blob 6cfa7ab430f5cea0d9df7d841947dbebb045d32c，234994 bytes。
- invoice-image-scanner.js：Git blob 434c6f13528a0034d678f3a453d07259431f4fb9，22299 bytes。
- invoice-qr-parser.js：Git blob 3b34b42f4966a6af6afb75391d5fd961c53b92c2，4164 bytes。
- receipt-ocr.js：Git blob 6096abfd07f6a3df39a926f203aa36ea26d478e0，11225 bytes。
- receipt-item-parser.js：Git blob c8aee1932b5b1a2f31e8559f206e8ee0358f610e，3477 bytes。
- dining-trip-import.js：Git blob 7464b53038cf68624b33a2a5d762318306f1dab5，4828 bytes。
- firebase.json：Git blob 8a555f4144e0ec4fcd5ab0b79ea237f73d9d5e96，58 bytes。
- firestore.rules：Git blob ba75d243d9a143661c083bd23e94d7020b2d4ecb，5197 bytes。

上線後另核對 Pages、公開 URL 檔案雜湊、版號、模組與瀏覽器錯誤。保留 v2.4.0 快照；網址與正式資料空間不變。
