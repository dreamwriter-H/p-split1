# Split Easy v2 共編與專案目錄設計

## 問題根因

v1 使用匿名 Firebase Auth，且每個瀏覽器以 `localStorage` 保存自己的首頁清單。因此同一個人換瀏覽器、換手機或清除網站資料後，就會取得不同匿名 UID 與不同首頁，看起來像「螞蟻洞」一直分岔。Firestore 內的專案未必真的複製，但入口分散、擁有權也無法可靠辨認。

## v2 設計原則

1. 使用 Google Auth 取得跨裝置穩定 UID。
2. 每個專案只有一份正式 Firestore 文件。
3. 專案成員名單決定讀寫權，不以「知道 projectId」當權限。
4. 個人首頁索引只存專案關係，不複製帳目內容。
5. 只有 owner 可建立邀請及刪除整個專案。
6. editor 可共同編輯，也可自行離開。

## 資料模型

```text
/apps/spliteasy-v2/projects/{projectId}
  ownerId
  ownerName
  schemaVersion
  type
  name
  data
  createdAt
  updatedAt

/apps/spliteasy-v2/projects/{projectId}/members/{uid}
  role: owner | editor
  joinedAt
  inviteId? 
  displayName
  email

/apps/spliteasy-v2/projects/{projectId}/invites/{inviteId}
  status: active | revoked
  createdBy
  createdAt
  role: editor

/users/{uid}/projects/{projectId}
  role: owner | editor
  joinedAt
```

## 邀請流程

1. owner 產生高強度隨機 `inviteId`。
2. 網址只帶 `?invite={projectId}.{inviteId}`。
3. 收件人先登入自己的 Google 帳號。
4. App 精確讀取該邀請，不允許列出全部邀請。
5. 同一個 batch 建立收件人的 member 與個人首頁索引。
6. 加入後所有人讀寫同一份 project 文件。

## 首頁流程

1. 讀取 `/users/{uid}/projects`。
2. 逐筆取得對應 project 文件。
3. 依 project 的 `updatedAt` 排序。
4. 若專案已被擁有者刪除，自動清除本人失效索引。

## 權限邊界

- 未登入及匿名登入：不能存取 v2。
- Google 使用者：只能列出自己的首頁索引。
- 非成員：不能讀取或修改專案。
- editor：可更新帳目，但不能改 ownerId、建立邀請或永久刪除。
- owner：可邀請、管理成員與永久刪除。
- v1 `artifacts/**`：全面拒絕讀寫，避免舊分頁重新製造資料。

## 已知限制

目前專案內容仍以單一文件同步，多人同時在極短時間內修改不同欄位時，最後寫入者可能覆蓋前一位的整份資料。小型親友共編可先接受；若日後使用量變大，應把支出拆成獨立文件並使用 transaction／server timestamp。

