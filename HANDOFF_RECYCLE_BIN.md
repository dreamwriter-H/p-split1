# 回家接續：刪除確認與回收桶草稿

本分支 `feat/recoverable-entry-deletion` 以 main 的 `e1943b2`（正式 v2.4.1）為基礎。畫面標記為 `2.4.2-dev / v2.4.2-recycle-draft1`。尚未合併或部署 GitHub Pages，未讀寫真實 Firebase 帳目。

## 交給桌面版 Codex 的指示

在家用電腦開啟 `dreamwriter-H/p-split1`。先保存本機未提交的修改，再執行：

```sh
git fetch origin
git switch --track origin/feat/recoverable-entry-deletion
```

如果同名本機分支已存在，切換該分支並檢查差異，不要覆寫本機工作。可直接交給 Codex：

> 請讀取 HANDOFF_RECYCLE_BIN.md，接續 feat/recoverable-entry-deletion。先確認目前差異並重跑測試，再用獨立測試帳本驗證 Firebase 雙帳號同步、權限拒絕及重新登入後回收桶持久保存。不要操作現有私人帳本、合併 main 或部署，完成後提供驗收結果。

## 已完成的行為

- 聚餐「品項」與旅遊「支出」按刪除時先確認；取消不變更資料。
- 確認後先同步本機修改，再透過 Firestore transaction 讀最新專案並將完整紀錄移至 `project.data.recycleBin`。保留付款、分攤、收據、匯入資訊、刪除帳號 UID／顯示名稱／時間。
- 專案上方的回收桶可由所有有效共編成員還原。還原是另一筆交易，保留同期其他修改；重複還原不重複記帳。
- 比對確認時的品項與交易最新內容；其他人已修改或刪除時拒絕刪除，請使用者重新確認。
- 擋下已移除的付款／分攤成員、重複 ID、已重新匯入同來源聚餐的還原，不悄悄改動金額或分攤。
- 延遲的欄位修改不再重新建立已被刪除的實體，避免共編時復活紀錄。
- 有同步中／未同步／交易失敗保護及操作期間遮罩；交易失敗不回報成功。

## 資料與權限

新增本機模組 `entry-recycle-bin.js`；回收資料與帳目保存在同一份專案文件，不需要新增集合、密鑰或資料遷移。現有儲存庫 Firestore Rules 已允許有效專案成員更新該文件，並限制只有擁有者可刪除整份專案，因此此次未改 Rules。這是原碼檢查，未確認線上實際部署的規則內容。

回收桶是誤操作復原功能，不是防惡意竄改的稽核系統：現有 editor 權限仍可修改整份帳目，刪除者／時間來自客戶端，不能當作不可偽造的稽核證據。未加入所有修改的歷史紀錄，也未加入「只可刪自己的帳」限制。

## 已執行的驗證

```sh
node tests/dining-wallet.test.cjs
node --test tests/entry-recycle-bin.test.cjs
node tests/recycle-bin-browser.cjs
```

- 既有分帳／共編回歸：14 項通過。
- 新增回收桶與正式 App 交易處理器測試：14 項通過。後者使用記憶體交易 adapter，包含同步前置、權限拒絕、登出、切換專案、專案不存在，不代表線上 Firebase 驗收。
- Chromium 離線 UI：旅遊／聚餐各於 390px、1280px 共 4 組流程通過。實際 production 元件搭配本機 helper，測試取消、刪除、刪除者顯示、還原、空狀態、焦點循環與 Escape，頁面錯誤 0、外部請求 0。
- browser 測試也編譯整份 production JSX。UI harness 沒有載入 CDN 樣式，驗證操作流程，不是完整視覺驗收。

此靜態專案沒有 package.json；測試工具裝在 checkout 外。雲端 `SPLITEASY_TOOLS_DIR` 預設 `/workspace/setup-tools/p-split1/node_modules`，Chromium 預設 `/usr/bin/chromium`。桌面若沒有這些工具，可將 Babel standalone 7.28.5、React／React DOM 18.3.1、Playwright 1.62.1 安裝在另一個工具資料夾，設定 `SPLITEASY_TOOLS_DIR` 指向它的 node_modules，並設定 `CHROMIUM_PATH` 為本機 Chromium 執行檔路徑再執行 browser 測試。不要為了這些工具變更正式網站依賴。

啟動靜態網站：`python3 -m http.server 8000 --directory .`。Google 登入需使用 Firebase 已授權的開發網域；不要關閉驗證或繞過權限。舊 `validate-v2.3.1-production.cjs` 驗證固定舊版字串，不適合作為本草稿驗收門檻。

## 在家驗收與發布前必須注意

1. 以兩個 Google 帳號、專用測試帳本驗證 A 刪除、B 看到回收桶並還原、重新登入仍保留。驗證非成員／移除後不能操作；確認失敗時原帳目不消失。這些真實 Firebase 測試尚未執行。
2. 驗證多裝置同筆同時刪除、不同筆同時刪除、同筆同時還原、確認期間他人修改。用保留帳目快照核對金額與分攤。已測純函式的重試狀態與 mock handler，未做 Firebase emulator 或真實競爭壓力測試。
3. **舊分頁仍走舊刪除邏輯，無法保證進入回收桶。** 正式上線需提醒所有共編者重新載入；若要阻止所有舊版或惡意客戶端，需另外設計 Rules／資料版本與遷移策略，此分支不宣稱提供這種保證。
4. 回收桶最多 50 筆，不自動清除、不提供永久清空。到上限時會拒絕新刪除，必須先還原；接近文件容量時也拒絕刪除，保留原帳目。資料量超過 700,000 UTF-8 JSON bytes 時保守擋下；這不是完整的 Firestore 文件大小計算，實際後端拒絕仍由交易錯誤處理。大帳本之後應另做分文件儲存或受控清理設計。
5. 目前不提供移除成員復原，若回收品項引用的成員已移除，需管理者保留原資料並另行處理；不可只新增同名成員假裝是同一 ID。
6. 只涵蓋聚餐品項與旅遊支出，不涵蓋成員刪除、清空金額或所有欄位修改。整個專案仍是擁有者確認後永久刪除，回收桶隨之刪除；不是整個專案備份。發布前應決定是否另做整個專案封存。
7. 刪除／還原不會回溯修改其他專案中的聚餐匯入副本；按原有快照行為運作。
8. 完成真實登入、樣式及手機驗收後，再依使用者指示調整正式版號並透過 PR 發布；不可因本文件自行部署。

## GitHub 交接狀態

Git HTTPS 分支推送可用；GitHub API 目前回覆 Forbidden，草稿 PR 建立受阻。即使無 PR，桌面版仍可 fetch 此分支接續。PR 描述已保存在 `PR_RECYCLE_BIN.md`，可在 GitHub 網站以 main 為 base、此分支為 compare 建立 Draft PR。
