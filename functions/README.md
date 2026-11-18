# 過期回收桶伺服器清理 — 已備妥，尚未部署

本目錄是可供審查／部署的 Firebase Functions v2 原始碼。**加入 Git 或發布 GitHub Pages 不會部署這個排程函式。此功能目前未部署、未連線讀寫真實帳目。**

## 執行範圍

`purgeExpiredRecycleBin` 每 15 分鐘執行一次（`Asia/Taipei`，部署區域 `asia-east1`）。它以伺服器 `Date.now()` 檢查：

```text
apps/spliteasy-v2-2-prod/projects/{projectId}
```

只查詢頂層 `recycleBinNextExpiry` 為非空 ISO 字串且已到期的專案。每頁最多 100 份文件，每次最多 5 頁，依 expiry／文件 ID 續頁；餘下資料由後續排程處理。每個候選都在 transaction 內重讀，不能直接信任查詢快照。

真正更新僅包含四個欄位：

- `data.recycleBin`：只移除已能確定到期的回收紀錄。
- `recycleBinNextExpiry`：剩餘有效期限最早的 ISO 字串，沒有則為 `null`。
- `recoveryWriteToken`：新的 UUID。
- `recoveryWriteRevision`：依交易內最新數值增加 1。

不改動有效帳目、分攤、付款人或 `data.activityLog`。交易重試會重讀並重新計算，避免覆蓋其他人剛完成的還原、新增或歷程。未知／無效時間的資料會保留，並清除失效的到期索引，供管理者調查，不猜測刪除。

## 七天的精確界線

每筆刪除紀錄的還原資格在 `deletedAt + 7 × 24 小時` 當毫秒截止；若另有較早的有效 `expiresAt`，取較早值，不能延長七天。缺少 `expiresAt` 的舊紀錄可依有效 `deletedAt` 推算；無效 `deletedAt` 或明確無效的 `expiresAt` 不自動清除。

**七天資格截止不是七天當下立即物理抹除。** 此排程通常在下一次 15 分鐘檢查時移除到期回收資料；排程排隊、服務失敗、重試或單次批量上限可能造成更長延遲。操作歷程與有效帳目仍會保留；此函式不負責清除 Firestore 備份／PITR。

客戶端讀寫時的 `pruneExpired` 是輔助措施，不能取代無人開啟 App 時所需的伺服器清理。

## 部署前提與尚待動作

1. 先審查整合的客戶端、Firestore Rules 與本函式。每次客戶端回收桶變更必須同步維護頂層 `recycleBinNextExpiry`，並使用單調 `recoveryWriteRevision` 與新 token；不能只發布網站就宣稱排程已生效。
2. 確認 Firebase/GCP 專案是否已啟用 **Blaze 計費**及必要的 Cloud Functions v2、Cloud Run、Cloud Scheduler 等服務。可能產生計費，須由有權限的管理者確認。
3. 需要可用的 Firebase 管理端登入與部署 IAM 權限。GitHub 存取權或 App 的 Google 登入不等於 Firebase 管理權限。此工作未安裝 Firebase CLI，也未建立或索取服務帳戶金鑰。
4. 確認目標為 `spliteasy-2026`。完成依賴安裝與測試後，由管理者在專案根目錄使用既有可用 CLI 部署 **functions codebase `recovery-cleanup` 與 Firestore Rules**。網站部署、Rules 部署及函式部署是不同步驟，須分別核對成功。
5. 部署後以獨立測試專案驗證：未到期紀錄保留、到期後由排程移除、同時還原不覆寫、history 保留、revision 前進，並查看 Scheduler／Function 執行紀錄。此真實雲端驗證尚未執行。

既有缺少頂層索引的文件不會自動進入此查詢。正常客戶端寫入可補齊；若需要歷史回收資料回填，須另行審查與執行受控回填，不能聲稱本函式已掃描所有既有帳目。若部署後 Firestore 回報索引需求，管理者須依實際錯誤建立必要索引後再驗證。

## 本機檢查（不需要 Firebase 管理憑證）

```sh
cd functions
npm test
npm run check
```

這些測試使用 Node 內建 test runner 及記憶體 Firestore adapter，不會連線 Firebase。涵蓋七日期限邊界、未知時間、受控欄位更新、並行還原／新增、transaction retry、cursor 分頁／上限、單筆失敗隔離及 revision 前進。這不等於 Firebase Emulator 或實際排程驗收。

部署目標鎖定 Node.js 22；本機驗證機為 Node.js 24，產生鎖檔時因此出現 engine 警示，並非已在 Node.js 22 雲端執行過。`package-lock.json` 是以 package-lock-only／ignore-scripts 產生，沒有安裝 Firebase CLI 或執行 SDK 部署。

執行真正 SDK／部署工具前，可在 `functions/` 使用 `npm ci` 還原鎖定依賴；本目錄只提供部署原始碼與鎖檔，不會自行執行部署。
