(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.EntryRecycleBin = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
    const MAX_DOCUMENT_BYTES = 850000;
    const copy = value => JSON.parse(JSON.stringify(value));
    const fail = message => { throw new Error(message); };
    const stable = value => JSON.stringify(value, (_, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
        ? Object.fromEntries(Object.keys(nested).sort().map(key => [key, nested[key]])) : nested);
    const sameId = (left, right) => String(left) === String(right);
    const timestamp = value => {
        const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
        if (!Number.isFinite(time)) fail('無法確認操作時間，請重新整理後再試。');
        return time;
    };
    const slot = value => {
        const result = Number(value);
        if (!Number.isSafeInteger(result) || result < 1) fail('旅遊天數資料異常，請聯絡管理者。');
        return result;
    };
    const expenseDay = item => Math.max(1, parseInt(item?.day, 10) || 1);
    const itemLabel = item => String(item?.desc || item?.name || '未命名品項');
    const actorInfo = actor => {
        if (!actor?.uid) fail('無法確認操作者，請重新登入。');
        return { actorId: actor.uid, actorName: actor.name || actor.displayName || actor.email || '共編成員' };
    };
    const prepare = (project, actor, token, now) => {
        if (!project || !project.data || !token) fail('操作資料不完整，請重新開啟專案後再試。');
        actorInfo(actor);
        return { project: pruneExpired(project, now), now: timestamp(now), token: String(token) };
    };
    const collectionFor = project => project.type === 'travel' ? 'expenses'
        : project.type === 'dining' ? 'diningItems' : fail('不支援的專案類型。');
    const normalizeItem = (collection, item) => collection === 'expenses'
        ? { ...item, day: expenseDay(item) } : { ...item, participantIds: item?.participantIds || [] };
    const highestLegacyDay = data => Math.max(1, parseInt(data?.days, 10) || 1,
        ...(data?.expenses || []).map(expenseDay));

    function getDayNumbers(data = {}) {
        if (data.dayOrder !== undefined) {
            if (!Array.isArray(data.dayOrder) || !data.dayOrder.length) fail('旅遊至少需要保留一天。');
            const order = data.dayOrder.map(slot);
            if (new Set(order).size !== order.length) fail('旅遊天數資料重複，請聯絡管理者。');
            return order;
        }
        const max = highestLegacyDay(data);
        if (max > 100000) fail('旅遊天數資料異常，請聯絡管理者。');
        return Array.from({ length: max }, (_, index) => index + 1);
    }
    function getDayLabel(data, day) {
        const index = getDayNumbers(data).indexOf(slot(day));
        return index < 0 ? null : index + 1;
    }
    function daySnapshot(data, day) {
        const target = slot(day), order = getDayNumbers(data);
        if (!order.includes(target)) fail('這一天已不存在，請重新確認旅遊日程。');
        return { day: target, dayOrder: order, expenses: copy((data.expenses || []).filter(item => expenseDay(item) === target)) };
    }
    function archiveExpiry(entry) {
        const deleted = Date.parse(entry.deletedAt);
        if (!Number.isFinite(deleted)) return NaN;
        const hardDeadline = deleted + RETENTION_MS;
        if (entry.expiresAt === undefined) return hardDeadline;
        const explicit = Date.parse(entry.expiresAt);
        return Number.isFinite(explicit) ? Math.min(explicit, hardDeadline) : NaN;
    }
    // Seven days is restore eligibility. This client prunes on access/write;
    // the separately deployed scheduled function also cleans inactive projects.
    function updateExpiryIndex(project) {
        const times = (project.data?.recycleBin || []).map(archiveExpiry).filter(Number.isFinite);
        project.recycleBinNextExpiry = times.length ? new Date(Math.min(...times)).toISOString() : null;
        return project;
    }
    function pruneExpired(project, now = Date.now()) {
        const result = copy(project), time = timestamp(now);
        result.data = result.data || {};
        if (Array.isArray(result.data.recycleBin)) result.data.recycleBin = result.data.recycleBin.filter(entry => {
            const expires = archiveExpiry(entry);
            return !Number.isFinite(expires) || time < expires;
        });
        return updateExpiryIndex(result);
    }
    function assertCapacity(project) {
        const bytes = new TextEncoder().encode(JSON.stringify(project)).length;
        if (bytes > MAX_DOCUMENT_BYTES) fail('專案與歷程資料量已接近上限，這次操作尚未儲存。請先聯絡管理者備份整理，系統不會自動清除歷程。');
        return project;
    }
    function mergeRecords(first = [], second = []) {
        const result = [], seen = new Set();
        for (const entry of [...first, ...second]) {
            const key = String(entry.id);
            if (!seen.has(key)) { seen.add(key); result.push(copy(entry)); }
        }
        return result;
    }
    function addEvent(project, actor, token, now, event) {
        const log = project.data.activityLog || [];
        const eventId = `${token}:${event.collection || 'project'}:${event.entryId ?? event.day ?? 'settings'}:${event.action}`;
        if (!log.some(row => row.id === eventId)) log.push({ id: eventId, at: new Date(now).toISOString(), ...actorInfo(actor), ...event });
        project.data.activityLog = log;
    }
    function markUpdated(project, actor, now) {
        project.updatedAt = new Date(now).toISOString();
        project.lastUpdatedBy = actor.uid;
        return assertCapacity(updateExpiryIndex(project));
    }
    function archiveBase(actor, token, now) {
        const person = actorInfo(actor);
        return { id: token, deletedAt: new Date(now).toISOString(), expiresAt: new Date(now + RETENTION_MS).toISOString(),
            deletedBy: person.actorId, deletedByName: person.actorName };
    }
    function ensureUniqueArchive(project, token) {
        if ((project.data.recycleBin || []).some(entry => entry.id === token)) fail('這次操作識別碼已使用，請重新確認畫面。');
    }
    function preserveSequence(data, extra = []) {
        return Math.max(Number(data.daySequence) || 0, highestLegacyDay(data), ...getDayNumbers(data), ...extra,
            ...(data.recycleBin || []).filter(entry => entry.kind === 'day').map(entry => Number(entry.day) || 0));
    }
    function validateRestoreItems(data, collection, items) {
        const people = new Set((data.people || []).map(person => String(person.id)));
        const active = data[collection] || [], existingIds = new Set(active.map(item => String(item.id)));
        const sources = new Set(active.filter(item => item.diningImport?.sourceProjectId).map(item => String(item.diningImport.sourceProjectId)));
        for (const item of items) {
            if (!item || item.id == null) fail('回收紀錄格式不完整，請聯絡管理者。');
            if (existingIds.has(String(item.id))) fail('已有相同識別碼的記帳紀錄，無法重複還原。');
            existingIds.add(String(item.id));
            const references = collection === 'expenses'
                ? [...Object.keys(item.payers || {}), ...(item.splitBetween || []), ...Object.keys(item.splitAmounts || {}),
                    ...(item.diningImport?.shares || []).map(share => share.personId).filter(id => id != null)]
                : item.participantIds || [];
            if (references.some(id => !people.has(String(id)))) fail('原付款人或分攤成員已被移除，無法直接還原。請先保留資料並聯絡管理者。');
            if (item.diningImport?.sourceProjectId) {
                const source = String(item.diningImport.sourceProjectId);
                if (sources.has(source)) fail('這筆聚餐已重新匯入，無法再還原舊紀錄，以免重複計帳。');
                sources.add(source);
            }
        }
    }

    function moveToBin(project, request, actor, token, now = Date.now()) {
        const state = prepare(project, actor, token, now), result = state.project, data = result.data;
        ensureUniqueArchive(result, state.token);
        const base = archiveBase(actor, state.token, state.now);
        let archive;
        if (request?.kind === 'entry') {
            const collection = collectionFor(result);
            if (request.collection !== collection || request.item?.id == null) fail('記帳紀錄類型不符，未執行刪除。');
            const item = (data[collection] || []).find(entry => sameId(entry.id, request.item.id));
            if (!item) fail('這筆紀錄已不存在，可能已被其他成員刪除。');
            if (stable(normalizeItem(collection, item)) !== stable(normalizeItem(collection, request.item))) fail('這筆紀錄已被其他成員修改，請確認最新內容後再刪除。');
            archive = { ...base, kind: 'entry', label: itemLabel(item), collection, item: copy(item) };
            data[collection] = data[collection].filter(entry => !sameId(entry.id, item.id));
            addEvent(result, actor, state.token, state.now, { action: 'delete', collection, entryId: item.id, label: itemLabel(item), changedFields: [], archiveId: state.token });
        } else if (request?.kind === 'day') {
            if (result.type !== 'travel' || !request.snapshot) fail('無法確認要刪除的旅遊日程。');
            const day = slot(request.snapshot.day), current = daySnapshot(data, day), order = current.dayOrder;
            if (order.length < 2) fail('旅遊至少需要保留一天，不能刪除最後一天。');
            const normalizeSnapshot = snapshot => ({ day: slot(snapshot.day), dayOrder: snapshot.dayOrder.map(slot),
                expenses: (snapshot.expenses || []).map(item => normalizeItem('expenses', item)) });
            if (stable(normalizeSnapshot(current)) !== stable(normalizeSnapshot(request.snapshot))) fail('這一天的日程或帳目已被其他成員修改，請確認最新內容後再刪除。');
            const index = order.indexOf(day), sequence = preserveSequence(data);
            archive = { ...base, kind: 'day', label: `第 ${index + 1} 天`, day, expenses: copy(current.expenses),
                originalDayOrder: [...order], beforeDay: order[index - 1] ?? null, afterDay: order[index + 1] ?? null };
            data.expenses = (data.expenses || []).filter(item => expenseDay(item) !== day);
            data.dayOrder = order.filter(value => value !== day);
            data.days = Math.max(...data.dayOrder);
            data.daySequence = sequence;
            addEvent(result, actor, state.token, state.now, { action: 'delete-day', collection: 'days', day, label: archive.label, changedFields: [], archiveId: state.token });
            for (const item of current.expenses) addEvent(result, actor, state.token, state.now, { action: 'delete', collection: 'expenses', entryId: item.id, label: itemLabel(item), changedFields: [], archiveId: state.token, day });
        } else fail('不支援的刪除操作。');
        data.recycleBin = [...(data.recycleBin || []), archive];
        return markUpdated(result, actor, state.now);
    }

    function restore(project, token, actor, actionToken, now = Date.now()) {
        const state = prepare(project, actor, actionToken, now), result = state.project, data = result.data;
        // Inspect the original archive as well, to distinguish expiry from a second restore.
        const original = (project.data.recycleBin || []).find(entry => entry.id === token);
        if (original) {
            const expiry = archiveExpiry(original);
            if (!Number.isFinite(expiry)) fail('回收紀錄時間不完整，請聯絡管理者，未執行還原。');
            if (state.now >= expiry) fail('這筆紀錄已超過 7 天還原期限，無法還原。');
        }
        const archive = (data.recycleBin || []).find(entry => entry.id === token);
        if (!archive) fail('這筆紀錄已還原、過期或已不存在。');
        const collection = collectionFor(result);
        if (archive.kind === 'entry') {
            if (archive.collection !== collection) fail('回收紀錄類型與專案不符。');
            validateRestoreItems(data, collection, [archive.item]);
            if (collection === 'expenses' && !getDayNumbers(data).includes(expenseDay(archive.item))) fail('原記帳日已被移除，請先從回收桶還原該天，再還原這筆支出。');
            data[collection] = [...(data[collection] || []), { ...copy(archive.item), _recoveryGeneration: state.token }];
            addEvent(result, actor, state.token, state.now, { action: 'restore', collection, entryId: archive.item.id, label: itemLabel(archive.item), changedFields: [], archiveId: token });
        } else if (archive.kind === 'day') {
            if (result.type !== 'travel') fail('只有旅遊專案可以還原日程。');
            const day = slot(archive.day), order = getDayNumbers(data);
            if (order.includes(day)) fail('這個旅遊日程識別碼已存在，無法覆蓋或重複還原。');
            const items = archive.expenses || [];
            if (items.some(item => expenseDay(item) !== day)) fail('回收日程的支出資料不符，請聯絡管理者。');
            validateRestoreItems(data, 'expenses', items);
            const originalOrder = Array.isArray(archive.originalDayOrder) ? archive.originalDayOrder.map(slot) : [day, archive.afterDay].filter(value => value != null).map(slot);
            const originalIndex = originalOrder.indexOf(day);
            if (originalIndex < 0) fail('回收日程順序資料不完整，請聯絡管理者。');
            const nextAnchor = originalOrder.slice(originalIndex + 1).find(value => order.includes(value));
            const priorAnchor = originalOrder.slice(0, originalIndex).reverse().find(value => order.includes(value));
            const insertAt = nextAnchor != null ? order.indexOf(nextAnchor)
                : priorAnchor != null ? order.indexOf(priorAnchor) + 1 : order.length;
            const sequence = preserveSequence(data, [day]);
            order.splice(insertAt, 0, day);
            data.dayOrder = order;
            data.days = Math.max(...order);
            data.daySequence = sequence;
            data.expenses = [...(data.expenses || []), ...copy(items).map(item => ({ ...item, _recoveryGeneration: state.token }))];
            addEvent(result, actor, state.token, state.now, { action: 'restore', collection: 'days', day, label: archive.label, changedFields: [], archiveId: token });
            for (const item of items) addEvent(result, actor, state.token, state.now, { action: 'restore', collection: 'expenses', entryId: item.id, label: itemLabel(item), changedFields: [], archiveId: token, day });
        } else fail('回收紀錄格式不支援，請聯絡管理者。');
        data.recycleBin = data.recycleBin.filter(entry => entry.id !== token);
        return markUpdated(result, actor, state.now);
    }

    function addDay(project, actor, token, now = Date.now()) {
        const state = prepare(project, actor, token, now), result = state.project;
        if (result.type !== 'travel') fail('只有旅遊專案可以新增日程。');
        if ((result.data.activityLog || []).some(event => event.action === 'add-day' && event.id.startsWith(state.token + ':days:'))) fail('這次新增日程已完成，請重新確認畫面。');
        // Include not-yet-pruned legacy archives so an expired high slot is never reused.
        const sequence = Math.max(preserveSequence(result.data), preserveSequence(project.data));
        const day = sequence + 1;
        if (!Number.isSafeInteger(day)) fail('旅遊日程識別碼已達上限，請聯絡管理者。');
        result.data.dayOrder = [...getDayNumbers(result.data), day];
        result.data.days = Math.max(...result.data.dayOrder);
        result.data.daySequence = day;
        addEvent(result, actor, state.token, state.now, { action: 'add-day', collection: 'days', day, label: `第 ${result.data.dayOrder.length} 天`, changedFields: [] });
        return markUpdated(result, actor, state.now);
    }

    const fieldLabels = { desc: '名稱', name: '名稱', title: '活動名稱', amount: '金額', day: '所屬天數', payers: '付款人',
        splitBetween: '分攤成員', splitAmounts: '個人負擔', participantIds: '分攤成員', receiptMeta: '收據資料', diningImport: '聚餐匯入資料',
        people: '成員與共同錢包', totalBill: '帳單總額', customAmounts: '個人套餐金額', serviceChargeType: '服務費類型',
        serviceChargeValue: '服務費', splitMode: '分攤方式', billPayerId: '付款代表', date: '日期', invoiceMeta: '發票資料',
        days: '旅遊天數', dayOrder: '旅遊日程', daySequence: '旅遊日程序號', travelImport: '旅遊匯入紀錄' };
    const changedFields = (before = {}, after = {}) => [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(key => key !== 'id' && key !== '_recoveryGeneration' && stable(before[key]) !== stable(after[key])).map(key => fieldLabels[key] || key);
    function appendHistory(previousProject, nextProject, actor, token, now = Date.now()) {
        const state = prepare(nextProject, actor, token, now), result = state.project;
        const before = previousProject.data || {}, after = result.data;
        after.activityLog = mergeRecords(before.activityLog, after.activityLog);
        const restoredIds = new Set(after.activityLog.filter(event => event.action === 'restore' && event.archiveId).map(event => event.archiveId));
        after.recycleBin = mergeRecords(before.recycleBin, after.recycleBin).filter(entry => !restoredIds.has(entry.id) && (!Number.isFinite(archiveExpiry(entry)) || state.now < archiveExpiry(entry)));
        for (const collection of ['expenses', 'diningItems']) {
            const oldMap = new Map((before[collection] || []).map(item => [String(item.id), item]));
            const newMap = new Map((after[collection] || []).map(item => [String(item.id), item]));
            for (const id of new Set([...oldMap.keys(), ...newMap.keys()])) {
                const oldItem = oldMap.get(id), newItem = newMap.get(id);
                if (oldItem && newItem && stable(normalizeItem(collection, oldItem)) === stable(normalizeItem(collection, newItem))) continue;
                const explicit = after.activityLog.some(event => event.id.startsWith(state.token + ':') && event.collection === collection && sameId(event.entryId, id));
                if (explicit) continue;
                if (oldItem && newItem && !changedFields(oldItem, newItem).length) continue;
                const action = !oldItem ? 'create' : !newItem ? 'delete' : 'edit';
                const event = { action, collection, entryId: (newItem || oldItem).id, label: itemLabel(newItem || oldItem), changedFields: oldItem && newItem ? changedFields(oldItem, newItem) : [] };
                if (oldItem && newItem && oldItem.amount !== newItem.amount) event.detail = `金額 ${oldItem.amount ?? ''} → ${newItem.amount ?? ''}`;
                addEvent(result, actor, state.token, state.now, event);
            }
        }
        const ignored = new Set(['expenses', 'diningItems', 'activityLog', 'recycleBin']);
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !ignored.has(key) && stable(before[key]) !== stable(after[key]));
        if (keys.length) addEvent(result, actor, state.token, state.now, { action: 'edit', collection: 'settings', label: '專案設定', changedFields: keys.map(key => fieldLabels[key] || key) });
        return markUpdated(result, actor, state.now);
    }

    return { RETENTION_MS, MAX_DOCUMENT_BYTES, getDayNumbers, getDayLabel, daySnapshot,
        pruneExpired, assertCapacity, moveToBin, restore, addDay, appendHistory };
});
