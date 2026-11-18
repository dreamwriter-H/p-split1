'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bin = require('../entry-recycle-bin.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('const COLLAB_ENTITY_ARRAY_KEYS'), html.indexOf('const getProjectDisplayName'));
const { buildDataOperations: build, applyDataOperations: apply, assertRecoverableOperations: validate } = vm.runInNewContext(
    source + '\n({buildDataOperations,applyDataOperations,assertRecoverableOperations})',
    { window: { EntryRecycleBin: bin }, console }
);
const plain = value => JSON.parse(JSON.stringify(value));
const actor = { uid: 'editor', name: '兆' }, now = Date.parse('2026-11-18T06:23:00Z');
const expense = { id: 'meal', desc: '午餐', amount: 100, day: 2, payers: { 1: 100 }, splitBetween: [1] };
const project = () => ({ type: 'travel', data: { days: 3, people: [{ id: 1, name: '兆' }], expenses: [expense] } });

test('刪除後舊編輯不能復活帳目，且提交前明確報共編衝突', () => {
    const before = project();
    const operations = build(before.data, { ...before.data, expenses: [{ ...expense, amount: 150 }] });
    const deleted = bin.moveToBin(before, { kind: 'entry', collection: 'expenses', item: expense }, actor, 'delete-entry-token', now);
    assert.deepEqual(plain(apply(deleted.data, operations).expenses), []);
    assert.throws(() => validate(deleted, operations), error => error.code === 'collab-conflict');
});

test('刪除後還原相同ID，舊modal的變更仍不能覆蓋還原版本', () => {
    const before = project();
    const operations = build(before.data, { ...before.data, expenses: [{ ...expense, desc: '舊畫面名稱' }] });
    const deleted = bin.moveToBin(before, { kind: 'entry', collection: 'expenses', item: expense }, actor, 'delete-entry-token', now);
    const restored = bin.restore(deleted, 'delete-entry-token', actor, 'restore-entry-token', now + 1);
    assert.equal(apply(restored.data, operations).expenses[0].desc, '午餐');
    assert.throws(() => validate(restored, operations), /還原/);
    const fresh = build(restored.data, { ...restored.data, expenses: [{ ...restored.data.expenses[0], desc: '新版本編輯' }] });
    assert.doesNotThrow(() => validate(restored, fresh));
    assert.equal(apply(restored.data, fresh).expenses[0].desc, '新版本編輯');
});

test('新增空白聚餐品項後立即填寫，在同一個同步批次可正確新增與修改', () => {
    const before = { type: 'dining', data: { people: [{ id: 1 }], diningItems: [] } };
    const blank = { ...before.data, diningItems: [{ id: 'new', name: '', amount: '', participantIds: [1] }] };
    const filled = { ...blank, diningItems: [{ ...blank.diningItems[0], name: '咖啡', amount: '80' }] };
    const operations = [...build(before.data, blank), ...build(blank, filled)];
    assert.doesNotThrow(() => validate(before, operations));
    assert.deepEqual(plain(apply(before.data, operations).diningItems), filled.diningItems);
});

test('舊畫面新增支出不能寫進已刪天數，其他存活天數仍可新增', () => {
    const before = project();
    const deleted = bin.moveToBin(before, { kind: 'day', snapshot: bin.daySnapshot(before.data, 2) }, actor, 'delete-day-token', now);
    const stale = build(before.data, { ...before.data, expenses: [...before.data.expenses, { ...expense, id: 'stale-new' }] });
    assert.throws(() => validate(deleted, stale), /天數已被刪除/);
    assert.deepEqual(plain(apply(deleted.data, stale).expenses), []);
    const active = build(deleted.data, { ...deleted.data, expenses: [{ ...expense, id: 'valid-new', day: 3 }] });
    assert.doesNotThrow(() => validate(deleted, active));
    assert.equal(apply(deleted.data, active).expenses[0].day, 3);
});

test('一般畫面同步不能寫回舊回收桶、歷程與日序，也不能直接硬刪帳目', () => {
    const before = project();
    const metadataOnly = build(before.data, { ...before.data, recycleBin: [], activityLog: [], dayOrder: [1], daySequence: 1, days: 1 });
    assert.deepEqual(plain(metadataOnly), []);
    const deleted = bin.moveToBin(before, { kind: 'day', snapshot: bin.daySnapshot(before.data, 2) }, actor, 'delete-day-token', now);
    const injected = [{ type: 'data-field', key: 'recycleBin', value: [] }, { type: 'data-field', key: 'dayOrder', value: [1, 2, 3] }];
    assert.deepEqual(plain(apply(deleted.data, injected).recycleBin), deleted.data.recycleBin);
    assert.deepEqual(plain(apply(deleted.data, injected).dayOrder), [1, 3]);
    assert.throws(() => validate(before, build(before.data, { ...before.data, expenses: [] })), /回收桶/);
});

test('ID碰撞不會覆蓋既有帳目，彼此編輯不同欄位仍可合併並記錄實際修改', () => {
    const before = project();
    const collision = [{ type: 'entity-upsert', key: 'expenses', id: 'meal', value: { ...expense, amount: 1 } }];
    assert.throws(() => validate(before, collision), /重複/);
    assert.equal(apply(before.data, collision).expenses[0].amount, 100);
    const operations = build(before.data, { ...before.data, expenses: [{ ...expense, desc: '午餐與飲料' }] });
    const remote = project(); remote.data.expenses[0] = { ...expense, amount: 150, payers: { 1: 150 } };
    validate(remote, operations);
    const next = bin.appendHistory(remote, { ...remote, data: apply(remote.data, operations) }, actor, 'edit-entry-token', now);
    assert.equal(next.data.expenses[0].amount, 150);
    assert.equal(next.data.expenses[0].desc, '午餐與飲料');
    assert.equal(next.data.activityLog[0].actorName, '兆');
    assert.deepEqual(next.data.activityLog[0].changedFields, ['名稱']);
});

test('從已載入的帳本快照判斷回收資料是否到期', () => {
    const before = project();
    assert.equal(bin.hasExpiredArchives(before.data, now), false);
    const first = bin.moveToBin(before, { kind: 'entry', collection: 'expenses', item: expense }, actor, 'delete-entry-token', now);
    const expires = now + bin.RETENTION_MS;
    assert.equal(bin.hasExpiredArchives(first.data, expires - 1), false);
    assert.equal(bin.hasExpiredArchives(first.data, expires), true);
    const restored = bin.restore(first, 'delete-entry-token', actor, 'restore-entry-token', now + 1);
    assert.equal(bin.hasExpiredArchives(restored.data, expires), false);
    const pruned = bin.pruneExpired(first, expires);
    assert.equal(bin.hasExpiredArchives(pruned.data, expires), false);
    assert.equal(pruned.data.activityLog.length, first.data.activityLog.length);
});
