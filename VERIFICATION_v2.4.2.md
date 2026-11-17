# v2.4.2 — A.A 2GETHER 品牌發布前驗證

日期：2026-11-17（臺灣時間）。正式候選 `2.4.2 / v2.4.2-prod-r1`。

## 本版範圍

- 以正式 v2.4.1 提交 `e1943b218660859304532b1c6e5df6bef0450b1f` 為基礎，只帶入品牌 UI。
- 新顯示名稱 A.A 2GETHER；副標「數學不好，錢算得清楚就好」。更新繽紛疊卡開場、登入頁、頁首、網頁標題、共編邀請、錯誤畫面品牌及登出提示。
- 獨立字標與疊卡 WebP 圖檔總計 112,016 bytes，不增加執行期套件。
- 正式網址仍為 https://dreamwriter-h.github.io/p-split1/ 。Google OAuth 後台名稱未更動，Google 授權畫面仍可能顯示原應用程式名稱。
- 本版不包含回收桶。原分帳、編輯與刪除流程沿用 v2.4.1；誤刪保護另留開發分支，待真實共編驗收。

## 已完成驗證

- 完整 JSX 編譯通過；既有 `node tests/dining-wallet.test.cjs` 14 項通過。
- Chromium 390×844、320×568、1440×1024：原碼 SplashScreen／LoginScreen 元件共 6 個畫面，圖檔全數載入、無水平溢出、無頁面錯誤或失敗請求。
- 三種尺寸皆驗證登入按鈕 callback、開啟中 disabled、登入錯誤、邀請提示與減少動態效果。這些互動使用測試 callback，沒有真實登入或讀寫帳目。
- 與使用者選定的第 2 張設計作同尺寸並排比對。修正副標比例、320px 登入按鈕換行；剩餘字型細節差異列 P3。
- 舊版 Safari 相容檢查：移除 svh／cqw／container-type 宣告後，320／390／桌面尺寸的開場仍有有效寬高，副標不溢出。這是功能支援模擬，不是真實 Safari 裝置測試。
- 與 v2.4.1 比對：Firebase 設定、DATA_SPACE、USER_INDEX_SPACE、DATA_SCHEMA_VERSION、Firestore Rules、firebase.json、.firebaserc，以及五支業務 JS 模組均未修改。
- 共編資料合併函式、聚餐品項刪除、旅遊支出刪除及 Auth handler 與 v2.4.1 逐字相同。
- `git diff --check` 通過。

## 驗證限制

完整 production 頁面的外部 CDN 請求在雲端 Chromium 因平台代理 CA 未受信任而發生 ERR_CERT_AUTHORITY_INVALID。將平台 CA 加入瀏覽器信任庫的操作遭自動審核拒絕，因此未變更信任設定、未關閉 TLS 驗證。另觀察原有 Tailwind CDN 入口透過雲端 HTTP 客戶端回覆 403；未據此擅自改動原網站的 CDN 依賴。

正式網域 dreamwriter-h.github.io 與 api.github.com 尚未在執行中環境的允許清單；shell／Chromium 直接正式站檢查遭代理拒絕。所需網域已加入環境設定草稿，但儲存草稿不代表已套用。

Git HTTPS 與 github.com 網站可用，可推送並從 Actions 網頁確認部署工作的結論與完整提交 SHA。部署成功不等於正式網站已完成瀏覽器驗收；本文件不宣稱真實登入、正式站畫面或雙帳號共編已驗證。

## 發布與回復

發布前將保留 v2.4.1 備份分支，再以不強制推送方式更新 main，交由既有 GitHub Pages 工作發布。本文件記錄發布前檢查，實際部署結論另按 GitHub Actions 的指定提交核對。

本版沒有資料遷移或 schema 變更。若需回復，建立還原本次品牌提交的新 commit，保留既有 Git 歷史，不執行資料清除。
