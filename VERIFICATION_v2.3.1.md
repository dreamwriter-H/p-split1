# v2.3.1 聚餐錢包點選分組驗證

日期：2026-11-09。發布目標：v2.3.1（build：`v2.3.1-prod-r1`），使用者已明確授權正式部署。

- 完整 JSX 編譯成功；14 組計算與共編邏輯回歸測試通過。
- 發布前補上負淨額錢包反向退款，包含實際付款人與代表同組的案例；各組付出減收到等於其負擔淨額。
- Chrome 實際操作通過：頭像點選分組、再次點同一卡片取消、取消按鈕、Enter／空白鍵操作、收合卡片呈現與重新編輯、整組合併、點「×」退出、刪除代表、重新載入分組。
- 同組代墊、合併轉帳、全員同組、文字複製與實際下載結算圖片通過。
- 320／390 像素手機及桌面畫面、長中文姓名與連續英文字姓名檢查；受測畫面沒有水平溢出或頁面錯誤。
- 試用頁不初始化 Firebase；測試中正式服務連線為 0。
- 相較 v2.3.0，變更聚餐設定介面及版本標記，並補上負淨額錢包退款；同步、旅遊模式及正式資料結構未變。
- 舊版本保留於 `../p-split1-main/versions/v2.3.0-dining-wallet/` 與 `v2.3.1-wallet-tap/`；正式候選另保存為 `v2.3.1-production/`。

真實 iPhone／Safari 與雙帳號雲端共編仍待實機驗收。

## 發布前正式站核實

2026-11-09 讀取公開首頁與 GitHub main 原始碼：

- 正式站 <https://dreamwriter-h.github.io/p-split1/> 回應 HTTP 200，`APP_VERSION = '2.2.0'`、`BUILD_ID = 'v2.2.0'`。
- 儲存庫為 [dreamwriter-H/p-split1](https://github.com/dreamwriter-H/p-split1)，[版本宣告](https://github.com/dreamwriter-H/p-split1/blob/main/index.html#L48-L49)。
- main 最新提交為 `9b14e52ab3c530e94cae233673ce2269ffd9dd84`；首頁與本機 v2.2.0-production 基準忽略 CRLF／LF 後逐字一致。
- <https://dreamwriter-h.github.io/p-split/> 為另一個舊站，沒有上述版本宣告，不能當作 v2.2 正式入口。
