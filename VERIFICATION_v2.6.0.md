# v2.6.0 發布前驗證

狀態：功能草稿已存 GitHub 分支 `feat/v2.6.0-recovery-history`；正式 `main` 與 Firebase 尚未部署這批變更。

本次測試的 `index.html` SHA-256 為 `43f95c8245c14af5ef078614cf0c8c1e39605f56dba4e116e9f2def34b47da54`。

## 本機已通過

| 範圍 | 結果 | 驗證內容 |
| --- | --- | --- |
| Node 純邏輯及同步測試 | 45 個 runner tests 全過，包含錢包測試檔內的 14 情境 | 七天邊界、整天還原、穩定日序、零元／不完整品項、歷程、容量、匯入、舊修改不復活帳目 |
| 正式 handlers 與元件的瀏覽器整合 | 15/15 通過 | 真實刪除／還原／同步 handler，記憶體 Firestore 交易替身、重試、權限錯誤、雙文件匯入、token/revision |
| 完整 React App 瀏覽器回歸 | 9/9 通過，0 page errors | 確認焦點與取消、單次刪除還原、日選單、草稿保護、捨棄鎖定、開窗後刪除還原及遠端欄位保留 |
| 回收桶元件 | 32 項通過 | 320/390px、無橫向溢出、臺灣 HH:mm、過期隱藏、鍵盤 tabs、焦點、busy/error/empty |
| 開場額外停留 | 6/6 通過 | 真實 App effect＋虛擬時鐘，快／慢 auth、999/1000ms、卸載取消、8s 安全逾時、後續登入不重播 |
| 聚餐手機日期欄 | Chromium 320/375/390px 通過 | 父層與畫面右界、填入／清空、真實 click 觸發原生 showPicker |
| Spark 清理行為 | 5/5 通過 | 未到期不新增清理讀取，到期只清回收資料，保留同時新增的支出與歷程，關閉帳本後停止清理 |
| 語法及 patch | 通過 | Babel 解析實際 JSX、JS 語法、git diff --check |

可重跑的核心檢查：

```sh
node --test tests/*.test.cjs
```

瀏覽器測試使用正式 App 原始碼與模組，但 Firebase/Auth 用測試替身，資料全為虛構帳目；沒有登入／修改正式帳本，也不能據此認定正式 Firestore 規則已生效。參見 [測試結果與畫面](docs/v2.6.0/README.md)。

## 資料庫規則驗證

已提供 `tests/recovery-rules.emulator.cjs` 的 27 個真實 Emulator 情境。本環境下載 Firestore Emulator JAR 受到網路政策 403 阻擋，未在本機執行。新增的 [Recovery checks 工作流程](.github/workflows/recovery-checks.yml) 在 GitHub 測試機執行規則編譯與測試，沒有任何 deploy 指令或正式 Firebase 憑證。

首輪 GitHub 測試在啟動 Emulator 時中止。Firebase CLI 以設定檔所在的 `tests` 為專案根目錄，拒絕載入根目錄以外的 `../firestore.rules`。將設定檔移到儲存庫根目錄後，規則編譯、27 個 Emulator 情境、Node 測試及 JSX 編譯皆通過。[GitHub 測試結果](https://github.com/dreamwriter-H/p-split1/actions/runs/44222666428/job/134528116361)

## 上線前仍須完成

- 取得具 `spliteasy-2026` 管理權限的 Firebase 登入，部署規則，再用授權測試帳本驗證真實交易。
- iOS Safari 真機確認原生日期欄。此環境沒有 WebKit 執行檔，Chromium 無法代表 iOS 的原生控制項。
- 完成上述驗證才發布前端；發布順序及相容回退限制見 [交接文件](HANDOFF_v2.6.0_RECOVERY.md)。
