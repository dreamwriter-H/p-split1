# A.A 2GETHER v2.5.0 — 全站 UI 視覺 QA

final result: passed

本結果限本機正式元件與核可設計之比對；不代表正式站登入、真實共編及照片OCR驗收通過。已知雲端網路／憑證限制見 VERIFICATION_v2.5.0.md。

## Source truth 與實作證據

使用者已確認旅遊三頁，並核可其他三組9畫面、授權實作與發布。

- 設定圖：`/workspace/generated_images/exec-cfd592d2-c1ac-4286-b2d6-4a695f9f8e9a.png`
- 記帳圖：`/workspace/generated_images/exec-ec585334-732a-40b0-ac04-cd2c360e6a0e.png`
- 結算圖：`/workspace/generated_images/exec-d371fe43-a96c-4d0f-acd5-ad71120edec9.png`
- 首頁／聚餐組：`/workspace/generated_images/exec-d8d89566-45be-41a6-a4a4-490307b7013a.png`
- 錢包／支出組：`/workspace/generated_images/exec-688a5d5c-ffe4-455c-aba6-d549e76d49d9.png`
- 收據／共編組：`/workspace/generated_images/exec-ae603359-5166-4e95-a6d6-82222461e64c.png`

Source旅遊圖原始852×1846，正規化390×844，無裝置外框。實作採390×844 CSS viewport、deviceScaleFactor1，長頁保留真實捲動內容。未把整張生成圖當作App。正式元件由本機React渲染，套用實際樣式、FontAwesome與圖檔；帳目／帳號皆為fixture。

- 同一比較輸入、左稿右實作：`/workspace/scratch/ui-v250/comparison-travel-three.png`。
- 逐頁比較：`comparison-setup.png`、`comparison-expenses.png`、`comparison-settlement.png`。
- 聚焦金額與字體：`comparison-settlement-total-detail.png`。
- 長姓名與大金額：`contact-320-stress.png`。
- 其他畫面已逐張檢視；選定的實際程式版截圖另存並提交於 `docs/v2.5.0/`。

## 修正迭代

1. P1：窄螢幕極大金額裁切、名稱被金額／工具列擠成細長欄。加入可換行總額、摘要彈性欄寬與支出列換行。再次擷取320px壓力案例後，完整金額與名稱可見；不以document無溢出作唯一通過條件。
2. P2：設定雙重外距、結算摘要直排偏離圖稿。由單一pane管理外距，摘要採可換行左右布局；重新比較圖確認。
3. P2：旅遊新增FAB覆蓋編輯／刪除區。移至安全區底部，列表保留捲動空間，重新檢視一般和壓力狀態。
4. P2：危險確認被舊primary class覆蓋為藍色。提高語意樣式優先序，實際檢查紅底白字；其他主操作仍亮藍。
5. P2：可用刪除／移除圖示與登出圖示偏淡、看似disabled。啟用圖示改用較深的muted色，保留禁用狀態區隔。
6. P2：聚餐結算共同錢包仍沿用橘色。改成薄荷綠，與設定／分組使用同一語意。

沒有剩餘 P0／P1／P2。

## 五項面向

- 字體：使用系統sans-serif與現有CJK fallback；必要欄位16px，細節至少12px。選取有文字、aria與框線，不只靠顏色。極大金額可多行，不裁掉數字。
- 間距／布局：統一圓角、外距與表單節奏；手機320／390與桌面1440檢查。長結算保留原始明細及捲動，不為符合靜態稿而刪除資料。
- 色彩：薄荷設定／錢包、天藍記帳、檸檬結算、橘紅聚餐、亮藍主操作，危險紅獨立；正文深藍。
- 素材：沿用真實品牌字標，新增ImageGen透明角落圖；沒有用CSS／SVG仿製品牌插畫。原生分頁、選單、步驟圓點屬可操作UI，不是插畫替代品。
- 內容：保留實際計算結果與原始欄位。稿上的800元與fixture實算500元是示範帳目不同，不將稿上金額寫死。維持原四步驟、匯入與角色含義。

## 通過與限制

共60張狀態截圖，20狀態×320／390／1440，頁面錯誤及不預期網路請求0。完成分頁鍵盤／選取色、天數、輸入、支出新增編輯、錢包、分攤、建立／開啟帳本、複製與收據文字解析等本機互動檢查。詳細測試紀錄在雲端 `/workspace/scratch/ui-v250/manifest.json`。

P3：系統中文字型、原生select／date外觀與圖稿稍有差異，並保留較多真實明細與提示；部分圖稿的裝飾和人物小圖示簡化為既有FontAwesome／文字，避免影響操作與新增非必要資源。照片相機、真實Google登入、Firestore雙帳號及完整螢幕閱讀器驗收不在本次本機檢查結論內。
