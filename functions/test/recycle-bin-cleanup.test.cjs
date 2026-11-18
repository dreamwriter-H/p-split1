'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { archiveDeadline, planCleanup, purgeExpiredRecycleBins, RETENTION_MS, PROJECT_COLLECTION } = require('../recycle-bin-cleanup');
const now = Date.parse('2026-11-18T12:00:00.000Z');
const iso = time => new Date(time).toISOString();
const clone = value => structuredClone(value);
const archive = (id, deadline) => ({ id, kind: 'entry', deletedAt: iso(deadline - RETENTION_MS), expiresAt: iso(deadline), item: { id, desc: '保留原帳目', amount: 0 } });
const project = (id, entries, revision = 0) => ({ id, type: 'travel', recoveryWriteRevision: revision, recycleBinNextExpiry: entries.length ? iso(Math.min(...entries.map(archiveDeadline).filter(value => value != null))) : null,
    data: { expenses: [{ id: 'active', amount: 300, day: 1 }], activityLog: [{ id: 'history', action: 'edit', label: '不得刪除' }], recycleBin: entries } });

class MemoryDB {
    constructor(records) {
        this.records = new Map(records.map(value => [PROJECT_COLLECTION + '/' + value.id, clone(value)]));
        this.queries = []; this.writes = []; this.beforeTransaction = null; this.retryOnce = null; this.failedIds = new Set();
    }
    collection(path) { assert.equal(path, PROJECT_COLLECTION); return new Query(this); }
    snapshot(path) {
        const value = this.records.get(path);
        return { id: path.split('/').pop(), ref: { path }, exists: !!value, data: () => clone(value) };
    }
    async runTransaction(callback) {
        if (this.beforeTransaction) { const hook = this.beforeTransaction; this.beforeTransaction = null; await hook(this); }
        let writes;
        const transaction = () => ({
            get: async ref => { if (this.failedIds.has(ref.path.split('/').pop())) throw new Error('simulated transaction failure'); return this.snapshot(ref.path); },
            update: (ref, fields) => writes.push({ ref, fields: clone(fields) })
        });
        writes = [];
        let result = await callback(transaction());
        if (this.retryOnce) { const hook = this.retryOnce; this.retryOnce = null; await hook(this); writes = []; result = await callback(transaction()); }
        for (const write of writes) {
            const current = this.records.get(write.ref.path);
            assert.ok(current);
            const permitted = ['data.recycleBin', 'recycleBinNextExpiry', 'recoveryWriteToken', 'recoveryWriteRevision'];
            assert.deepEqual(Object.keys(write.fields).sort(), permitted.sort());
            const updated = clone(current);
            updated.data.recycleBin = write.fields['data.recycleBin'];
            for (const field of permitted.filter(field => field !== 'data.recycleBin')) updated[field] = write.fields[field];
            this.records.set(write.ref.path, updated); this.writes.push(write);
        }
        return result;
    }
    read(id) { return this.records.get(PROJECT_COLLECTION + '/' + id); }
}
class Query {
    constructor(db, config = { where: [], order: [] }) { this.db = db; this.config = config; }
    next(patch) { return new Query(this.db, { ...this.config, ...patch }); }
    where(...args) { return this.next({ where: [...this.config.where, args] }); }
    orderBy(field) { return this.next({ order: [...this.config.order, field] }); }
    limit(value) { return this.next({ limit: value }); }
    startAfter(snapshot) { return this.next({ cursor: { expiry: snapshot.data().recycleBinNextExpiry, id: snapshot.id } }); }
    async get() {
        this.db.queries.push(clone(this.config));
        let records = [...this.db.records.entries()].filter(([, value]) => this.config.where.every(([field, operator, expected]) => {
            const actual = value[field];
            return typeof actual === 'string' && (operator === '>' ? actual > expected : actual <= expected);
        })).sort((a, b) => a[1].recycleBinNextExpiry.localeCompare(b[1].recycleBinNextExpiry) || a[1].id.localeCompare(b[1].id));
        const cursor = this.config.cursor;
        if (cursor) records = records.filter(([, value]) => value.recycleBinNextExpiry > cursor.expiry || (value.recycleBinNextExpiry === cursor.expiry && value.id > cursor.id));
        return { docs: records.slice(0, this.config.limit).map(([path]) => this.db.snapshot(path)) };
    }
}
const options = extra => { let sequence = 0; return { now: () => now, randomUUID: () => 'uuid-' + ++sequence, ...extra }; };

test('純helper：七天截止當毫秒到期，expiry不得延長硬期限', () => {
    const value = archive('boundary', now);
    assert.equal(planCleanup(project('p', [value]), now - 1).removed, 0);
    assert.equal(planCleanup(project('p', [value]), now).removed, 1);
    value.expiresAt = iso(now + RETENTION_MS);
    assert.equal(archiveDeadline(value), now);
    value.expiresAt = iso(now - 1000);
    assert.equal(archiveDeadline(value), now - 1000);
    delete value.expiresAt;
    assert.equal(archiveDeadline(value), now);
});

test('無效deletedAt／expiresAt保留，不以猜測時間永久清除', () => {
    for (const value of [{ id: 'unknown' }, { deletedAt: 'bad', expiresAt: iso(now - 1) }, { deletedAt: iso(now - RETENTION_MS), expiresAt: null }]) {
        assert.equal(archiveDeadline(value), null);
        const plan = planCleanup({ data: { recycleBin: [value] }, recycleBinNextExpiry: iso(now - 1) }, now);
        assert.equal(plan.removed, 0);
        assert.deepEqual(plan.remaining, [value]);
        assert.equal(plan.nextExpiry, null);
    }
});

test('helper不修改輸入，剩餘nextExpiry取最早，保留帳目歷程', () => {
    const value = project('p', [archive('expired', now), archive('later', now + 500), archive('next', now + 100)]), before = clone(value);
    const plan = planCleanup(value, now);
    assert.deepEqual(value, before);
    assert.deepEqual(plan.remaining.map(entry => entry.id), ['later', 'next']);
    assert.equal(plan.nextExpiry, iso(now + 100));
    assert.equal(plan.removed, 1);
    assert.equal(plan.needsWrite, true);
});

test('Firestore query固定collection、ISO上下界、expiry/docID排序、limit100', async () => {
    const db = new MemoryDB([project('p', [archive('old', now)])]);
    const summary = await purgeExpiredRecycleBins(db, options({ documentIdField: '__name__' }));
    assert.deepEqual(db.queries[0].where, [['recycleBinNextExpiry', '>', ''], ['recycleBinNextExpiry', '<=', iso(now)]]);
    assert.deepEqual(db.queries[0].order, ['recycleBinNextExpiry', '__name__']);
    assert.equal(db.queries[0].limit, 100);
    assert.equal(summary.removed, 1);
});

test('只更新指定field paths，保留現有帳目、history與其它專案欄位', async () => {
    const value = project('p', [archive('old', now), archive('new', now + 1000)], 7);
    value.otherField = { nested: 'must remain' };
    const db = new MemoryDB([value]);
    const summary = await purgeExpiredRecycleBins(db, options());
    const result = db.read('p');
    assert.deepEqual(result.data.expenses, value.data.expenses);
    assert.deepEqual(result.data.activityLog, value.data.activityLog);
    assert.deepEqual(result.otherField, value.otherField);
    assert.deepEqual(result.data.recycleBin.map(entry => entry.id), ['new']);
    assert.equal(result.recycleBinNextExpiry, iso(now + 1000));
    assert.equal(result.recoveryWriteRevision, 8);
    assert.equal(result.recoveryWriteToken, 'uuid-1');
    assert.equal(summary.updated, 1);
});

test('查詢後另一人已還原時，交易讀最新資料且不覆寫還原帳目／history', async () => {
    const db = new MemoryDB([project('p', [archive('old', now)])]);
    db.beforeTransaction = async current => {
        const value = current.read('p');
        value.data.recycleBin = []; value.recycleBinNextExpiry = null;
        value.data.expenses.push({ id: 'restored', amount: 100, day: 1 });
        value.data.activityLog.push({ id: 'restoration', action: 'restore' });
        value.recoveryWriteRevision = 2;
    };
    const summary = await purgeExpiredRecycleBins(db, options());
    assert.equal(summary.updated, 0);
    assert.equal(db.read('p').data.expenses.length, 2);
    assert.equal(db.read('p').data.activityLog.length, 2);
    assert.equal(db.read('p').recoveryWriteRevision, 2);
    assert.equal(db.writes.length, 0);
});

test('交易重試期間另一人新增archive／帳目，清除採用新快照與新revision', async () => {
    const db = new MemoryDB([project('p', [archive('old', now)], 4)]);
    db.retryOnce = async current => {
        const value = current.read('p');
        value.data.recycleBin.push(archive('concurrent', now + 1000));
        value.data.expenses.push({ id: 'concurrent-entry', amount: 500 });
        value.data.activityLog.push({ id: 'concurrent-history', action: 'create' });
        value.recoveryWriteRevision = 5;
    };
    const summary = await purgeExpiredRecycleBins(db, options());
    assert.equal(summary.updated, 1);
    assert.equal(summary.removed, 1);
    assert.deepEqual(db.read('p').data.recycleBin.map(entry => entry.id), ['concurrent']);
    assert.equal(db.read('p').recoveryWriteRevision, 6);
    assert.equal(db.read('p').data.expenses.length, 2);
    assert.equal(db.read('p').data.activityLog.length, 2);
    assert.equal(db.writes.length, 1);
});

test('交易每次以server clock重算，不使用scheduler排程時間假設', async () => {
    const value = project('p', [archive('old', now), archive('during', now + 100)]);
    const db = new MemoryDB([value]); let calls = 0;
    const summary = await purgeExpiredRecycleBins(db, options({ now: () => calls++ === 0 ? now : now + 100 }));
    assert.equal(summary.removed, 2);
    assert.equal(db.read('p').recycleBinNextExpiry, null);
});

test('cursor分頁在更新expiry後仍向前；執行有頁數上限', async () => {
    const records = Array.from({ length: 205 }, (_, index) => project('p' + String(index).padStart(3, '0'), [archive('old', now)]));
    const db = new MemoryDB(records);
    const summary = await purgeExpiredRecycleBins(db, options({ maxPages: 2 }));
    assert.equal(summary.scanned, 200);
    assert.equal(summary.updated, 200);
    assert.equal(summary.pages, 2);
    assert.equal(summary.limited, true);
    assert.ok(db.queries[1].cursor);
    assert.equal([...db.records.values()].filter(value => value.data.recycleBin.length).length, 5);
    const next = await purgeExpiredRecycleBins(db, options());
    assert.equal(next.updated, 5);
    assert.equal([...db.records.values()].filter(value => value.data.recycleBin.length).length, 0);
});

test('invalid timestamp候選清除過時index後不再反覆查到，不丟未知紀錄', async () => {
    const value = project('invalid', []);
    value.data.recycleBin = [{ id: 'unknown', deletedAt: 'bad', expiresAt: iso(now - 1) }];
    value.recycleBinNextExpiry = iso(now - 1);
    const db = new MemoryDB([value]);
    const first = await purgeExpiredRecycleBins(db, options());
    assert.equal(first.updated, 1); assert.equal(first.removed, 0);
    assert.equal(db.read('invalid').data.recycleBin.length, 1);
    assert.equal(db.read('invalid').recycleBinNextExpiry, null);
    assert.equal((await purgeExpiredRecycleBins(db, options())).scanned, 0);
});

test('候選專案被刪除時跳過；某筆交易失敗不阻止其他專案清理', async () => {
    const db = new MemoryDB([project('a', [archive('old-a', now)]), project('b', [archive('old-b', now)]), project('c', [archive('old-c', now)])]);
    db.failedIds.add('b');
    db.beforeTransaction = async current => current.records.delete(PROJECT_COLLECTION + '/a');
    const errors = [];
    const summary = await purgeExpiredRecycleBins(db, options({ concurrency: 1, onError: (error, context) => errors.push([error.message, context.projectId]) }));
    assert.equal(summary.updated, 1); assert.equal(summary.skipped, 1); assert.equal(summary.failed, 1);
    assert.equal(db.read('c').data.recycleBin.length, 0);
    assert.equal(db.read('b').data.recycleBin.length, 1);
    assert.equal(errors[0][1], 'b');
});

test('無expiry／null／空字串／未到期專案不查；repeatedrun不重寫', async () => {
    const none = project('none', []), empty = project('empty', []), future = project('future', [archive('fresh', now + 1)]);
    delete none.recycleBinNextExpiry; empty.recycleBinNextExpiry = '';
    const db = new MemoryDB([none, empty, future]);
    const summary = await purgeExpiredRecycleBins(db, options());
    assert.equal(summary.scanned, 0); assert.equal(db.writes.length, 0);
});

test('無效revision保留原資料並記錄失敗，不重設為小版本', async () => {
    const value = project('p', [archive('old', now)], -1), db = new MemoryDB([value]);
    const summary = await purgeExpiredRecycleBins(db, options());
    assert.equal(summary.failed, 1);
    assert.deepEqual(db.read('p'), value);
});

test('非法server時間／無效bounds拒絕啟動，避免失控掃描', async () => {
    assert.throws(() => planCleanup({}, NaN), /timestamp/);
    const db = new MemoryDB([]);
    await assert.rejects(() => purgeExpiredRecycleBins(db, options({ pageSize: 101 })), /bounds/);
    await assert.rejects(() => purgeExpiredRecycleBins(db, options({ maxPages: 51 })), /bounds/);
    await assert.rejects(() => purgeExpiredRecycleBins(db, options({ now: () => NaN })), /clock/);
    assert.equal(db.queries.length, 0);
});
