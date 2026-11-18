'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../entry-recycle-bin.js');
const { moveToBin, restore, addDay, appendHistory, pruneExpired, getDayNumbers, getDayLabel, daySnapshot, RETENTION_MS, assertCapacity } = api;
const { clearHistory, getHistoryCleanupIds, hasDeletedEntry, HISTORY_KEEP_MS } = api;
const now = Date.parse('2026-11-18T08:00:00.000Z');
const actor = { uid: 'editor-1', name: '小安' };
const clone = value => structuredClone(value);
const expense = (id = 'e1', day = 1, amount = 100) => ({ id, day, desc: `支出${id}`, amount, payers: { 1: amount }, splitBetween: [1, 2] });
const trip = () => ({ id: 'trip', type: 'travel', ownerId: 'owner', data: {
    name: '示範旅遊', days: 3, people: [{ id: 1, name: '小安' }, { id: 2, name: '小美' }],
    expenses: [expense('e1', 1), expense('e2', 2, 200), expense('e3', 3, 300)]
} });
const dining = () => ({ id: 'dining', type: 'dining', data: { title: '聚餐', people: [{ id: 1 }, { id: 2 }],
    totalBill: 300, customAmounts: { 1: 100, 2: 200 }, diningItems: [{ id: 'food', name: '折扣', amount: 0, participantIds: [1, 2] }] } });
const request = item => ({ kind: 'entry', collection: 'expenses', item: clone(item) });
const deleted = () => { const project = trip(); return moveToBin(project, request(project.data.expenses[0]), actor, 'archive-entry', now); };
const withoutGeneration = items => items.map(({ _recoveryGeneration, ...item }) => item);

test('UMD 在瀏覽器暴露 EntryRecycleBin，Node export 相同 API', () => {
    const context = { TextEncoder, Date };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../entry-recycle-bin.js'), 'utf8'), context);
    assert.equal(typeof context.EntryRecycleBin.moveToBin, 'function');
    assert.equal(context.EntryRecycleBin.RETENTION_MS, RETENTION_MS);
    assert.equal(RETENTION_MS, 604800000);
});

test('legacy 天數含支出最高日；stable dayOrder 顯示連續序號但保留槽位', () => {
    assert.deepEqual(getDayNumbers({ days: 2, expenses: [{ day: 4 }] }), [1, 2, 3, 4]);
    const data = { dayOrder: [1, 4, 8], days: 8 };
    assert.deepEqual(getDayNumbers(data), [1, 4, 8]);
    assert.equal(getDayLabel(data, 4), 2);
    assert.equal(getDayLabel(data, 8), 3);
    assert.equal(getDayLabel(data, 2), null);
    assert.throws(() => getDayNumbers({ dayOrder: [] }), /至少需要/);
    assert.throws(() => getDayNumbers({ dayOrder: [1, 1] }), /重複/);
});

test('單筆刪除保存完整欄位、操作者與七日期限；還原增加 generation', () => {
    const project = trip(), original = clone(project);
    project.data.expenses[0].receiptMeta = { source: 'receipt', originalAmount: 100 };
    const item = clone(project.data.expenses[0]);
    const result = moveToBin(project, request(item), actor, 'archive-entry', now);
    assert.equal(result.data.expenses.length, 2);
    const archive = result.data.recycleBin[0];
    assert.deepEqual(archive.item, item);
    assert.equal(archive.deletedBy, actor.uid);
    assert.equal(archive.deletedByName, actor.name);
    assert.equal(Date.parse(archive.expiresAt) - Date.parse(archive.deletedAt), RETENTION_MS);
    assert.equal(result.data.activityLog[0].action, 'delete');
    const restored = restore(result, 'archive-entry', actor, 'restore-action', now + 1);
    const record = restored.data.expenses.find(entry => entry.id === item.id);
    assert.equal(record._recoveryGeneration, 'restore-action');
    assert.deepEqual(withoutGeneration([record]), [item]);
    assert.equal(restored.data.recycleBin.length, 0);
    assert.equal(project.data.expenses.length, original.data.expenses.length);
    assert.equal(project.data.recycleBin, undefined);
    assert.equal(result.data.recycleBin.length, 1);
});

test('零元聚餐品項與名稱修改可以刪除／還原，不以 truthiness 丟失金額', () => {
    const project = dining(), item = project.data.diningItems[0];
    const result = moveToBin(project, { kind: 'entry', collection: 'diningItems', item }, actor, 'zero', now);
    const restored = restore(result, 'zero', actor, 'zero-restore', now + 1);
    assert.equal(restored.data.diningItems[0].amount, 0);
    assert.equal(restored.data.totalBill, 300);
    assert.deepEqual(restored.data.customAmounts, project.data.customAmounts);
});

test('legacy day／participantIds 預設與物件欄位順序不誤判刪除', () => {
    const project = trip(); delete project.data.expenses[0].day;
    const expected = Object.fromEntries(Object.entries({ ...project.data.expenses[0], day: 1 }).reverse());
    assert.equal(moveToBin(project, request(expected), actor, 'legacy-day', now).data.recycleBin.length, 1);
    const meal = dining(); delete meal.data.diningItems[0].participantIds;
    assert.equal(moveToBin(meal, { kind: 'entry', collection: 'diningItems', item: { ...meal.data.diningItems[0], participantIds: [] } }, actor, 'legacy-participant', now).data.recycleBin.length, 1);
});

test('確認後同筆金額／名稱／分攤修改會拒絕刪除，無輸入變動', () => {
    for (const patch of [{ amount: 101 }, { desc: '新名稱' }, { splitBetween: [1] }]) {
        const project = trip(), item = clone(project.data.expenses[0]);
        Object.assign(project.data.expenses[0], patch);
        const before = clone(project);
        assert.throws(() => moveToBin(project, request(item), actor, 'conflict', now), /已被其他成員修改/);
        assert.deepEqual(project, before);
    }
    const project = trip(), item = clone(project.data.expenses[0]); project.data.expenses.shift();
    assert.throws(() => moveToBin(project, request(item), actor, 'missing', now), /已不存在/);
});

test('七日截止前1ms仍可還原，截止當毫秒與之後都不可', () => {
    const project = deleted();
    assert.equal(restore(project, 'archive-entry', actor, 'last-ms', now + RETENTION_MS - 1).data.recycleBin.length, 0);
    assert.throws(() => restore(project, 'archive-entry', actor, 'boundary', now + RETENTION_MS), /超過 7 天/);
    assert.throws(() => restore(project, 'archive-entry', actor, 'after', now + RETENTION_MS + 1), /超過 7 天/);
});

test('pruneExpired 只清除已過期資料，不變動原輸入或歷程', () => {
    const project = deleted(); project.data.recycleBin.push({ id: 'unknown-time', kind: 'entry' });
    const before = clone(project);
    assert.equal(pruneExpired(project, now + RETENTION_MS - 1).data.recycleBin.length, 2);
    const pruned = pruneExpired(project, now + RETENTION_MS);
    assert.deepEqual(pruned.data.recycleBin.map(entry => entry.id), ['unknown-time']);
    assert.deepEqual(pruned.data.activityLog, project.data.activityLog);
    assert.deepEqual(project, before);
    assert.throws(() => restore(project, 'unknown-time', actor, 'invalid-time', now), /時間不完整/);
});

test('舊紀錄沒有 expiresAt 時依 deletedAt 計算七天，不延長期限', () => {
    const project = deleted(); delete project.data.recycleBin[0].expiresAt;
    assert.equal(pruneExpired(project, now + RETENTION_MS).data.recycleBin.length, 0);
    assert.throws(() => restore(project, 'archive-entry', actor, 'legacy-expired', now + RETENTION_MS), /超過 7 天/);
});

test('整天刪除保留穩定槽位、完整帳目與個別刪除事件', () => {
    const project = trip(), snapshot = daySnapshot(project.data, 2), before = clone(project);
    const result = moveToBin(project, { kind: 'day', snapshot }, actor, 'archive-day', now);
    assert.deepEqual(result.data.dayOrder, [1, 3]);
    assert.equal(result.data.days, 3);
    assert.equal(result.data.daySequence, 3);
    assert.deepEqual(result.data.expenses.map(item => item.day), [1, 3]);
    const archive = result.data.recycleBin[0];
    assert.equal(archive.beforeDay, 1); assert.equal(archive.afterDay, 3);
    assert.deepEqual(archive.originalDayOrder, [1, 2, 3]);
    assert.deepEqual(archive.expenses, [project.data.expenses[1]]);
    assert.deepEqual(result.data.activityLog.map(row => [row.collection, row.action, row.entryId]), [['expenses', 'delete', 'e2']]);
    assert.deepEqual(project, before);
});

test('日程或當天帳目在確認後新增／修改／刪除都拒絕整天刪除', () => {
    for (const mutate of [
        p => p.data.expenses.push(expense('new', 2)),
        p => { p.data.expenses[1].amount = 201; },
        p => { p.data.expenses = p.data.expenses.filter(item => item.day !== 2); },
        p => { p.data.dayOrder = [1, 3, 2]; }
    ]) {
        const project = trip(), snapshot = daySnapshot(project.data, 2); mutate(project);
        assert.throws(() => moveToBin(project, { kind: 'day', snapshot }, actor, 'changed-day', now), /已被其他成員修改/);
    }
});

test('只有一天時不能刪除；多天的空白天仍可刪除與還原', () => {
    const one = trip(); one.data.days = 1; one.data.expenses = [];
    assert.throws(() => moveToBin(one, { kind: 'day', snapshot: daySnapshot(one.data, 1) }, actor, 'only', now), /最後一天/);
    const project = trip(); project.data.expenses = [];
    const result = moveToBin(project, { kind: 'day', snapshot: daySnapshot(project.data, 2) }, actor, 'empty', now);
    const restored = restore(result, 'empty', actor, 'empty-restore', now + 1);
    assert.deepEqual(restored.data.dayOrder, [1, 2, 3]);
    assert.deepEqual(restored.data.expenses, []);
    assert.deepEqual(restored.data.activityLog || [], []);
});

test('刪中間日後新增使用新槽位，還原插回下一原始anchor之前且保留新增日', () => {
    const project = trip();
    const removed = moveToBin(project, { kind: 'day', snapshot: daySnapshot(project.data, 2) }, actor, 'middle', now);
    const added = addDay(removed, actor, 'add', now + 1);
    assert.deepEqual(added.data.dayOrder, [1, 3, 4]);
    const restored = restore(added, 'middle', actor, 'restore-middle', now + 2);
    assert.deepEqual(restored.data.dayOrder, [1, 2, 3, 4]);
    assert.equal(restored.data.daySequence, 4);
    assert.equal(restored.data.expenses.find(item => item.id === 'e2')._recoveryGeneration, 'restore-middle');
    assert.equal(restored.data.expenses.find(item => item.id === 'e3').day, 3);
});

test('下一anchor被刪除時找其他原始日；最後日放回前anchor之後而非新增日之後', () => {
    const project = trip(); project.data.days = 4; project.data.expenses.push(expense('e4', 4));
    const first = moveToBin(project, { kind: 'day', snapshot: daySnapshot(project.data, 2) }, actor, 'day2', now);
    const second = moveToBin(first, { kind: 'day', snapshot: daySnapshot(first.data, 3) }, actor, 'day3', now + 1);
    const added = addDay(second, actor, 'day5', now + 2);
    assert.deepEqual(restore(added, 'day2', actor, 'restore2', now + 3).data.dayOrder, [1, 2, 4, 5]);
    const last = moveToBin(trip(), { kind: 'day', snapshot: daySnapshot(trip().data, 3) }, actor, 'last', now);
    assert.deepEqual(restore(addDay(last, actor, 'new-day', now + 1), 'last', actor, 'restore-last', now + 2).data.dayOrder, [1, 2, 3, 4]);
});

test('逾期歷史日槽位也不重用，daySequence不倒退', () => {
    const project = trip(); project.data.recycleBin = [{ id: 'old-day', kind: 'day', day: 9, deletedAt: new Date(now - RETENTION_MS).toISOString(), expiresAt: new Date(now).toISOString() }];
    const result = addDay(project, actor, 'new', now);
    assert.deepEqual(result.data.dayOrder, [1, 2, 3, 10]);
    assert.equal(result.data.daySequence, 10);
    assert.deepEqual(result.data.recycleBin, []);
});

test('原日程已移除的單筆支出需先還原天數，再還原支出', () => {
    const project = trip();
    const itemRemoved = moveToBin(project, request(project.data.expenses[1]), actor, 'item', now);
    const dayRemoved = moveToBin(itemRemoved, { kind: 'day', snapshot: daySnapshot(itemRemoved.data, 2) }, actor, 'day', now + 1);
    assert.throws(() => restore(dayRemoved, 'item', actor, 'premature', now + 2), /先從回收桶還原該天/);
    const restoredDay = restore(dayRemoved, 'day', actor, 'day-first', now + 2);
    assert.equal(restore(restoredDay, 'item', actor, 'item-last', now + 3).data.expenses.length, 3);
});

test('相同ID、同聚餐來源、缺少付款／分攤成員時保留回收資料拒絕還原', () => {
    const duplicate = deleted(); duplicate.data.expenses.push(expense('e1'));
    assert.throws(() => restore(duplicate, 'archive-entry', actor, 'dup', now + 1), /相同識別碼/);
    const missing = deleted(); missing.data.people.pop();
    assert.throws(() => restore(missing, 'archive-entry', actor, 'member', now + 1), /成員已被移除/);
    const imported = trip(); imported.data.expenses[0].diningImport = { sourceProjectId: 'dinner' };
    const archived = moveToBin(imported, request(imported.data.expenses[0]), actor, 'import', now);
    archived.data.expenses.push({ ...expense('new'), diningImport: { sourceProjectId: 'dinner' } });
    assert.throws(() => restore(archived, 'import', actor, 'repeat', now + 1), /已重新匯入/);
    assert.equal(archived.data.recycleBin.length, 1);
});

test('整日還原不覆蓋同槽位／同支出ID，缺少成員也整筆拒絕', () => {
    const original = trip();
    const removed = moveToBin(original, { kind: 'day', snapshot: daySnapshot(original.data, 2) }, actor, 'day', now);
    const collision = clone(removed); collision.data.dayOrder.push(2);
    assert.throws(() => restore(collision, 'day', actor, 'slot-collision', now + 1), /識別碼已存在/);
    const itemCollision = clone(removed); itemCollision.data.expenses.push(expense('e2', 3));
    assert.throws(() => restore(itemCollision, 'day', actor, 'id-collision', now + 1), /相同識別碼/);
    const missing = clone(removed); missing.data.people.pop();
    assert.throws(() => restore(missing, 'day', actor, 'missing', now + 1), /成員已被移除/);
    assert.deepEqual(removed.data.dayOrder, [1, 3]);
});

test('一般歷程涵蓋新增、改名、零元金額、刪除與操作者；輸入不變', () => {
    const before = trip(), after = clone(before);
    after.data.expenses[0].desc = '改名'; after.data.expenses[0].amount = 0;
    after.data.expenses.pop(); after.data.expenses.push(expense('new', 2));
    const snapshot = clone(after);
    const result = appendHistory(before, after, actor, 'edit', now);
    assert.deepEqual(after, snapshot);
    const logs = result.data.activityLog;
    assert.deepEqual(logs.map(row => row.action), ['edit', 'delete', 'create']);
    assert.deepEqual(logs[0].changedFields, ['名稱', '金額']);
    assert.match(logs[0].detail, /100 → 0/);
    assert.equal(logs[0].actorId, actor.uid); assert.equal(logs[0].actorName, '小安');
    assert.equal(logs[0].at, new Date(now).toISOString());
    assert.equal(result.updatedAt, logs[0].at);
});

test('店名、成員、共同錢包與結算設定可以儲存，但只記錄實際品項異動', () => {
    const before = dining(), after = clone(before);
    after.data.title = '新聚餐'; after.data.totalBill = 0; after.data.customAmounts = { 2: 200, 1: 0 };
    after.data.people[0].name = '新名字'; after.data.people[0].payerId = 2; after.data.serviceChargeValue = 10;
    const result = appendHistory(before, after, actor, 'settings', now);
    assert.deepEqual(result.data, { ...after.data, activityLog: [], recycleBin: [] });
    after.data.diningItems[0].amount = 50;
    const edited = appendHistory(before, after, actor, 'item-plus-settings', now);
    assert.deepEqual(edited.data.activityLog.map(row => [row.collection, row.entryId, row.changedFields]), [['diningItems', 'food', ['金額']]]);
});

test('由擁有者清理已確認的舊紀錄與舊設定，保留剛滿48小時、並行新增、帳目與回收桶', () => {
    const original = trip(), owner = { uid: original.ownerId, name: '擁有者' };
    const archived = moveToBin(original, request(original.data.expenses[0]), actor, 'old-archive', now - HISTORY_KEEP_MS - 1);
    const at = millis => new Date(millis).toISOString();
    archived.data.activityLog.push(
        { id: 'boundary', collection: 'expenses', action: 'edit', at: at(now - HISTORY_KEEP_MS) },
        { id: 'recent', collection: 'expenses', action: 'create', at: at(now - 1) },
        { id: 'legacy-settings', collection: 'settings', action: 'edit', at: at(now - 1) }
    );
    const ids = getHistoryCleanupIds(archived.data, now);
    assert.deepEqual(ids, ['old-archive:expenses:e1:delete', 'legacy-settings']);
    const concurrent = { id: 'later-added', collection: 'expenses', action: 'edit', at: at(now - HISTORY_KEEP_MS - 5) };
    archived.data.activityLog.push(concurrent);
    const snapshot = clone(archived);
    assert.throws(() => clearHistory(archived, ids, actor, now), /只有帳本擁有者/);
    const cleaned = clearHistory(archived, [...ids, 'boundary', 'recent'], owner, now);
    assert.deepEqual(cleaned.data.activityLog.map(row => row.id), ['boundary', 'recent', concurrent.id]);
    assert.deepEqual(cleaned.data.expenses, archived.data.expenses);
    assert.deepEqual(cleaned.data.recycleBin, archived.data.recycleBin);
    assert.deepEqual(archived, snapshot);
    assert.ok(hasDeletedEntry(cleaned.data, 'expenses', 'e1'));
    assert.equal(clearHistory(cleaned, ids, owner, now), cleaned);
    const restored = restore(cleaned, 'old-archive', actor, 'restore-after-cleanup', now + 1);
    assert.equal(restored.data.expenses.find(item => item.id === 'e1').amount, 100);
    assert.ok(restored.data.activityLog.some(row => row.action === 'restore' && row.entryId === 'e1'));
});

test('清理舊版日程紀錄後仍拒絕重送日程或重新合併已還原回收項目', () => {
    const owner = { uid: 'owner', name: '擁有者' };
    const archived = deleted();
    const restored = restore(archived, 'archive-entry', actor, 'restore-before-cleanup', now + 1);
    // Previous app versions only had history rows for these guards.
    delete restored.data.historyGuards;
    restored.data.activityLog.push({ id: 'legacy-day:days:4:add-day', action: 'add-day', collection: 'days', at: new Date(now).toISOString() });
    const later = now + HISTORY_KEEP_MS + 2;
    const cleaned = clearHistory(restored, getHistoryCleanupIds(restored.data, later), owner, later);
    assert.deepEqual(cleaned.data.activityLog, []);
    assert.throws(() => addDay(cleaned, actor, 'legacy-day', later), /已完成/);
    const stale = clone(cleaned);
    stale.data.recycleBin = archived.data.recycleBin;
    assert.deepEqual(appendHistory(cleaned, stale, actor, 'stale-recycle', later).data.recycleBin, []);
});

test('保留既有歷程與回收桶；同token事件去重，不記錄純generation變更', () => {
    const before = deleted(), after = clone(before); after.data.activityLog = []; delete after.data.recycleBin;
    after.data.expenses[0].amount = 0;
    const result = appendHistory(before, after, actor, 'edit', now + 1);
    assert.equal(result.data.recycleBin.length, 1);
    assert.equal(result.data.activityLog.length, 2);
    const repeated = appendHistory(before, result, actor, 'edit', now + 1);
    assert.equal(repeated.data.activityLog.length, 2);
    const gen = trip(), genAfter = clone(gen); genAfter.data.expenses[0]._recoveryGeneration = 'metadata';
    assert.equal(appendHistory(gen, genAfter, actor, 'generation', now).data.activityLog.length, 0);
});

test('所有寫入會prune過期，但永不按筆數裁切未過期回收桶／歷程', () => {
    const before = trip();
    before.data.recycleBin = Array.from({ length: 60 }, (_, index) => ({ id: 'retained-' + index, kind: 'entry', deletedAt: new Date(now).toISOString(), expiresAt: new Date(now + RETENTION_MS).toISOString() }));
    before.data.recycleBin.push({ id: 'expired', kind: 'entry', deletedAt: new Date(now - RETENTION_MS).toISOString(), expiresAt: new Date(now).toISOString() });
    before.data.activityLog = Array.from({ length: 101 }, (_, index) => ({ id: 'history-' + index, label: '保留' }));
    const result = moveToBin(before, request(before.data.expenses[0]), actor, 'new-archive', now);
    assert.equal(result.data.recycleBin.length, 61);
    assert.equal(result.data.activityLog.length, 102);
    assert.ok(!result.data.recycleBin.some(entry => entry.id === 'expired'));
});

test('UTF8容量上限拒絕新增、刪除／還原或歷程寫入，不破壞原資料', () => {
    const project = trip(); project.data.note = '測'.repeat(290000);
    const snapshot = clone(project);
    assert.throws(() => assertCapacity(project), /接近上限/);
    assert.throws(() => addDay(project, actor, 'large-day', now), /接近上限/);
    assert.throws(() => moveToBin(project, request(project.data.expenses[0]), actor, 'large-entry', now), /接近上限/);
    assert.throws(() => appendHistory(trip(), project, actor, 'large-history', now), /接近上限/);
    assert.deepEqual(project, snapshot);
    const archive = deleted(); archive.data.note = '測'.repeat(290000);
    assert.throws(() => restore(archive, 'archive-entry', actor, 'large-restore', now), /接近上限/);
    assert.equal(archive.data.recycleBin.length, 1);
});

test('非法操作者、類型、時間與重複archive token會清楚拒絕', () => {
    const project = trip(), item = project.data.expenses[0];
    assert.throws(() => moveToBin(project, request(item), {}, 'actor', now), /重新登入/);
    assert.throws(() => moveToBin(project, { kind: 'entry', collection: 'diningItems', item }, actor, 'type', now), /類型不符/);
    assert.throws(() => addDay(project, actor, 'clock', NaN), /操作時間/);
    const duplicate = deleted();
    assert.throws(() => moveToBin(duplicate, request(duplicate.data.expenses[0]), actor, 'archive-entry', now), /識別碼已使用/);
    assert.throws(() => addDay(dining(), actor, 'not-trip', now), /只有旅遊/);
});


test('expiresAt 不可延長 deletedAt 加七天；缺少有效 deletedAt 不可還原', () => {
    const project = deleted();
    project.data.recycleBin[0].expiresAt = new Date(now + RETENTION_MS * 2).toISOString();
    assert.equal(pruneExpired(project, now + RETENTION_MS).data.recycleBin.length, 0);
    assert.throws(() => restore(project, 'archive-entry', actor, 'extended', now + RETENTION_MS), /超過 7 天/);
    const missing = deleted(); delete missing.data.recycleBin[0].deletedAt;
    assert.equal(pruneExpired(missing, now + RETENTION_MS * 2).data.recycleBin.length, 1);
    assert.throws(() => restore(missing, 'archive-entry', actor, 'missing-deleted', now + 1), /時間不完整/);
    const invalid = deleted(); invalid.data.recycleBin[0].expiresAt = null;
    assert.throws(() => restore(invalid, 'archive-entry', actor, 'invalid-expiry', now + 1), /時間不完整/);
});


test('同一輸入與token重試結果確定；已完成新增日程不會再新增第二天', () => {
    const project = trip(), snapshot = daySnapshot(project.data, 2);
    assert.deepEqual(moveToBin(project, { kind: 'day', snapshot }, actor, 'retry', now), moveToBin(project, { kind: 'day', snapshot }, actor, 'retry', now));
    const added = addDay(project, actor, 'add-once', now);
    assert.throws(() => addDay(added, actor, 'add-once', now), /已完成/);
    assert.deepEqual(added.data.dayOrder, [1, 2, 3, 4]);
});
