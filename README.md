# Split Easy v2.2.0

Split Easy 是以 Google 帳號登入的雲端共編分帳 App，支援聚餐、旅遊、臺灣電子發票雙 QR 與海外收據本機 OCR。

## 使用入口

- 正式入口：<https://dreamwriter-h.github.io/p-split1/>
- 歷史驗收入口：<https://dreamwriter-h.github.io/p-split1/v2-preview/>
- 正式入口固定不含版本號；版本由頁面底部顯示的 `APP_VERSION` 與 `BUILD_ID` 辨識。

`/v2-preview/` 僅保留 rc4 歷史驗證頁。其舊資料空間已停寫，不能當成正式記帳入口。

## v2.2.0 重點

- 修正 Safari／iPhone 中文注音組字完成時可能因延後讀取事件物件而白頁的問題。
- 新增 Error Boundary 與可復原錯誤畫面，並顯示版本與 build。
- 先完成 Google Auth 持久化設定再啟動資料監聽；登入畫面清楚顯示目前 email 與 UID 尾碼。
- 首頁索引不再因一次暫時性的 `permission-denied` 就被刪除；增加 pending write 保護、重試與 `ensureIndex` 自癒。
- 移除成員、離開專案及刪除專案時，以 batch 同步維護個人索引。
- 拍照與相簿選取分成獨立入口；相簿輸入不使用 `capture`，可正常開啟既有照片。
- 電子發票整張照片先以原始像素掃描左右 QR 半區，再視需要進入後備流程；三張實際樣本共六個 QR 均通過回歸測試。
- 發票與收據影像仍只在使用者瀏覽器內解析，不上傳 Firebase。

## 正式資料結構

v2.2.0 使用全新的正式資料空間，沒有匯入 v2.1 或預覽版帳目：

```text
apps/spliteasy-v2-2-prod/projects/{projectId}
  members/{googleUid}
  invites/{randomInviteId}

users/{googleUid}/spaces/spliteasy-v2-2-prod/projects/{projectId}
```

- `projects` 是共編專案的唯一帳本。
- `members` 是實際存取權限名單。
- `invites` 是不能列出、只可由完整邀請網址讀取的隨機邀請碼。
- `users/.../projects` 只保存首頁索引，不複製帳目內容。
- 舊 v1、v2.1 與 v2.2 preview 路徑均由 Firestore Rules 明確拒絕讀寫。

## 功能

### 聚餐模式

- 均攤、各自套餐、共享／指定／個人品項混合分攤。
- 百分比或固定服務費、墊付人、整數尾差與結算轉帳。
- 臺灣電子發票整張拍攝、相簿選取、雙 QR 本機辨識與匯入前校對。

### 旅遊模式

- 共同錢包、多人代墊、複雜分攤與每日小計。
- 可新增及切換第 1 天、第 2 天等日程。
- 臺灣電子發票雙 QR，以及海外一般收據本機 OCR。
- 保留外幣原始金額、幣別、人工匯率與新臺幣換算紀錄。

### 共編與安全

- 只有 Google 帳號可使用正式資料。
- 擁有者可建立／撤銷邀請與移除成員；協作者可共編或離開。
- 專案只允許有效成員讀取；個人索引只允許本人讀取。
- Google/Firebase Auth 帳號不會因帳本資料重設而刪除。

## 發布與驗證

1. 以完整 rc4 runtime 為正式基準，不從終端輸出重建大型 `index.html`。
2. 檢查完整檔案大小、必要元件、Babel JSX 編譯、v2.2 靜態標記及發票掃描回歸。
3. 先部署 Firestore Rules，開啟 `spliteasy-v2-2-prod` 並凍結舊資料空間。
4. 再將相同完整資產發布至固定正式入口。
5. 公開頁面需以真實瀏覽器確認 React root 已渲染且沒有 page error。

資料重設邊界與驗證證據記錄於 `DATA_RESET_GATE.md`；完整歷程見 `VERSION_HISTORY.md`。

## 隱私與費用

- Google 登入只用於辨認身分與專案權限，App 不會取得 Google 密碼。
- 發票與海外收據照片只在目前瀏覽器記憶體內解析，不上傳 Firebase。
- 小型親友使用通常可落在 Firebase 免費額度內；仍建議設定用量警示並定期查看讀寫量。
