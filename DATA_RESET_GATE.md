# v2.2.0 正式切換與資料重設紀錄

日期：2026-09-22  
Firebase 專案：`spliteasy-2026`  
正式入口：<https://dreamwriter-h.github.io/p-split1/>

## 授權與保留邊界

使用者已明確授權永久刪除 Split Easy 過去所有記帳、專案、共編成員、邀請與首頁索引資料，並將 v2.2.0 視為全新正式帳本。

下列項目必須保留：

- 全部 Google/Firebase Authentication 帳號。
- Git commit、tag、release 與歷史程式版本。
- `users/{uid}` 根文件及其他未列入白名單的 subcollection。
- Firebase 專案、Firestore database、provider 與其他非 Split Easy 資料。

## 刪除白名單

只允許刪除以下精確路徑中的文件：

```text
apps/spliteasy-v2/projects/{projectId}
apps/spliteasy-v2/projects/{projectId}/members/{memberId}
apps/spliteasy-v2/projects/{projectId}/invites/{inviteId}
users/{uid}/projects/{projectId}

apps/spliteasy-v2-2-preview/projects/{projectId}
apps/spliteasy-v2-2-preview/projects/{projectId}/members/{memberId}
apps/spliteasy-v2-2-preview/projects/{projectId}/invites/{inviteId}
users/{uid}/spaces/spliteasy-v2-2-preview/projects/{projectId}
```

舊 v1 `artifacts/spliteasy-2026/public/data/projects` 在刪除前盤點為 0，因此不執行刪除。

禁止模糊 collection-group delete、刪除 `users/{uid}`、其他 `spaces`、`apps` 根文件或 Auth 帳號。

## 刪除前即時盤點

| 類別 | Projects | Members | Invites | Indexes | 小計 |
|---|---:|---:|---:|---:|---:|
| v2.1 `spliteasy-v2` | 13 | 16 | 1 | 3 | 33 |
| v2.2 preview | 1 | 2 | 1 | 2 | 6 |
| v1 | 0 | 0 | 0 | 0 | 0 |
| v2.2 production | 0 | 0 | 0 | 0 | 0 |

合計待刪除 39 份 Firestore 文件。Auth 盤點為 5 個 Google 帳號、0 個匿名帳號。

> 上表是開始實作時的唯讀盤點。正式刪除前會再次即時盤點，若數量或路徑出現未解釋差異，就停止刪除。

## 執行順序

1. 驗證完整正式 runtime、Babel、靜態條件與三張發票六個 QR。
2. 部署 Firestore Rules：開放 `spliteasy-v2-2-prod`，並凍結 v1、v2.1、preview。
3. 發布固定正式入口並以真實瀏覽器確認 React 成功渲染。
4. 重新盤點防止 race，只依白名單永久刪除。
5. 確認所有舊空間為 0、新正式空間仍為 0，且 Auth 帳號數不變。

## 執行結果

尚待完成正式部署與刪除後填入最終 ruleset、commit、Pages run、實際刪除數與複查證據。
