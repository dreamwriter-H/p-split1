# Split Easy v2.0.0 上線與資料歸零清單

## 目的

把 v1 的匿名身分與瀏覽器本機首頁改為 Google 身分及雲端個人目錄，並在確認新版可用後，清除所有 v1 測試／既有專案與匿名帳號。

## 不可顛倒的安全順序

1. 保留 v1.4.0 完整快照。
2. 建立並本機檢查 v2.0.0。
3. Firebase 啟用 Google 登入與正式授權網域。
4. 部署 v2 Firestore Rules；規則同時拒絕 v1 `artifacts/**` 的所有新讀寫。
5. 部署 v2 網頁。
6. 使用兩個不同 Google 帳號測試：
   - A 建立聚餐與旅遊專案。
   - A 建立邀請；B 加入同一個專案。
   - A、B 在首頁都只看到自己擁有／獲分享的專案。
   - B 可編輯，但不能邀請或刪除整個專案。
   - A 更新後，B 即時看到同一份資料。
7. 清點並匯出 v1 路徑與 Auth 使用者數量。
8. 經最後確認後，遞迴刪除 v1 專案、members、invites 與匿名 Auth 使用者。
9. 再次確認 v2 專案與 Google Auth 使用者未被刪除。

## 舊資料的精確範圍

- Firestore 舊路徑：`artifacts/spliteasy-2026/public/data/projects/**`
- Firebase Authentication：`isAnonymous == true` 的使用者
- 各裝置首頁：`localStorage.splitEasy_myProjects`

瀏覽器本機資料無法從伺服器遠端擦除；v2 會在每台裝置下一次開啟時自動刪除舊首頁清單，並登出殘留匿名身分。

## 清除前檢查

- [ ] 已記錄舊 Firestore 專案、members、invites 的精確筆數
- [ ] 已保存必要的匯出檔或確認不需備份
- [ ] v2 Rules 已拒絕舊路徑
- [ ] v2 正式網址已用 Google 帳號驗證
- [ ] 刪除目標不包含 `apps/spliteasy-v2/**`
- [ ] 刪除 Auth 時只選匿名帳號，不選 Google 帳號

## 回復方式

- 程式可從 `versions/v1.4.0-whole-receipt-scanner/` 回復。
- Firestore 舊資料一旦刪除，若事前沒有匯出則無法復原。
- 因此資料刪除必須放在整個切換流程的最後一步。

