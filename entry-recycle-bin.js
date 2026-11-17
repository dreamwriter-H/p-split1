(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SplitEasyRecycleBin = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const MAX_ENTRIES = 50;
    const copy = value => JSON.parse(JSON.stringify(value));
    const fail = message => { throw new Error(message); };
    const stable = value => JSON.stringify(value, (_, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
        ? Object.fromEntries(Object.keys(nested).sort().map(key => [key, nested[key]])) : nested);
    const collectionFor = type => type === 'travel' ? 'expenses' : type === 'dining' ? 'diningItems' : fail('不支援的專案類型。');
    const comparable = (type, item) => type === 'travel'
        ? { ...item, day: Math.max(1, parseInt(item.day, 10) || 1) }
        : { ...item, participantIds: item.participantIds || [] };

    // Run inside a Firestore transaction against its latest project, never a cached UI copy.
    function moveToBin(project, expectedItem, actor, token, now) {
        if (!actor?.uid || !token || !now) fail('無法確認刪除者，請重新登入。');
        const key = collectionFor(project.type), data = project.data || {};
        const items = data[key] || [], bin = data.recycleBin || [];
        const item = items.find(entry => String(entry.id) === String(expectedItem.id));
        if (!item) fail('這筆紀錄已不存在，可能已被其他成員刪除。');
        if (stable(comparable(project.type, item)) !== stable(comparable(project.type, expectedItem))) {
            fail('這筆紀錄已被其他成員修改，請關閉提示並確認最新內容後再刪除。');
        }
        if (bin.length >= MAX_ENTRIES) fail('回收桶已達 50 筆。請先還原紀錄；目前沒有永久清空功能。');
        if (bin.some(entry => entry.id === token)) fail('回收紀錄識別碼重複，請重試。');
        const next = {
            ...data,
            [key]: items.filter(entry => String(entry.id) !== String(item.id)),
            recycleBin: [...bin, {
                id: token, collection: key, item: copy(item), deletedAt: now,
                deletedBy: actor.uid, deletedByName: actor.displayName || actor.email || '共編成員'
            }]
        };
        // Leave headroom below Firestore's 1 MiB document limit (including metadata).
        if (new TextEncoder().encode(JSON.stringify({ ...project, data: next })).length > 700000) {
            fail('專案資料量已偏大，暫時無法加入回收桶；紀錄尚未刪除，請先聯絡管理者備份整理。');
        }
        return next;
    }

    function restore(project, token) {
        const key = collectionFor(project.type), data = project.data || {};
        const bin = data.recycleBin || [], entry = bin.find(record => record.id === token);
        if (!entry) fail('這筆紀錄已還原或已不存在。');
        if (entry.collection !== key || !entry.item || entry.item.id == null) fail('回收紀錄格式不符，請聯絡管理者。');
        const items = data[key] || [], item = entry.item;
        if (items.some(existing => String(existing.id) === String(item.id))) fail('已有相同識別碼的紀錄，無法重複還原。');
        const people = new Set((data.people || []).map(person => String(person.id)));
        const references = key === 'expenses'
            ? [...Object.keys(item.payers || {}), ...(item.splitBetween || []), ...Object.keys(item.splitAmounts || {})]
            : item.participantIds || [];
        if (references.some(id => !people.has(String(id)))) fail('原付款人或分攤成員已被移除，請先恢復成員資料再還原。');
        if (item.diningImport?.sourceProjectId && items.some(existing =>
            existing.diningImport?.sourceProjectId === item.diningImport.sourceProjectId)) {
            fail('這筆聚餐已重新匯入，無法再還原舊紀錄，以免重複計帳。');
        }
        return { ...data, [key]: [...items, copy(item)], recycleBin: bin.filter(record => record.id !== token) };
    }
    return { moveToBin, restore, MAX_ENTRIES };
});
