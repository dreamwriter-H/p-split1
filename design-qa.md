# A.A 2GETHER v2.4.2 — 品牌視覺 QA

final result: passed

本結果限於本機原碼元件渲染與設計比對，不表示正式網址／真實 Google 登入驗收通過。外部 HTTPS 與正式站阻擋見 VERIFICATION_v2.4.2.md。

- Source visual truth：`/workspace/generated_images/exec-c3ffe90c-52d4-4ac0-afe2-027a31e13c22.png`，使用者選定的第 2 張繽紛疊卡。
- Source pixels：852×1846，正規化至 390×844。
- Implementation screenshot：`/workspace/scratch/aa-brand-preview/splash-390.png`；CSS viewport390×844，deviceScaleFactor1，無裝置外框，載入開場狀態。
- 同圖並排比較：`/workspace/scratch/aa-production-release/source-vs-production.png`；左為選稿、右為正式候選。聚焦字標比較見 `/workspace/scratch/aa-brand-preview/comparison-brand-detail.png`（先前相同品牌版面，正式候選另補非視覺相容備援）。
- 額外檢查：320×568／1440×1024 開場與登入頁，截圖位於 `/workspace/scratch/aa-brand-preview/`。

## 發現與修正

- P2 已修正：副標比例與內距偏離選稿；調整至單行黃色標籤，實際渲染再比對通過。
- P2 已修正：320px 登入按鈕末字換行；調整字級及間距，重拍確認完整顯示。
- P1 已修正：只支援 svh／cqw 時舊版 Safari 可得到0×0開場；補上 vh／vw 備援，移除新語法模擬後三種尺寸均有效。
- 無剩餘 P0／P1／P2。

## 必查面向

- Typography：獨立圖檔保留 A.A 圓點與笑臉、2GETHER；副標與說明為可讀網頁文字，字級依開場比例縮放。
- Layout：沿選稿左上字標、黃色副標、中央疊卡與底部載入點；桌面維持直式開場比例，登入頁延伸雙欄，手機保持單欄。
- Colors：淺灰白底、亮藍品牌、橘紅／天藍／檸檬黃／薄荷綠；未使用暗紫背景。
- Assets：實際獨立生成字標與插畫 WebP，全數載入；圖內的卡片名稱保留於插畫，不以程式繪圖替代。
- Copy：A.A 2GETHER；數學不好，錢算得清楚就好；聚餐・旅遊・共同分帳。頁首與顯示品牌同步更新。

登入 callback、busy／disabled、錯誤／邀請提示及 reduced-motion 三尺寸檢查通過；本機元件瀏覽器錯誤0。字標邊緣與系統中文字型相較生成選稿略有差異，列 P3 後續微調。完整 production CDN 啟動、正式站與 Google 登入未通過或未執行的部分不納入此視覺通過結論。
