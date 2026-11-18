'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../dining-trip-import.js');

const source = {
    title: '週末聚餐', date: '2026-11-18',
    people: [{ id: 1, name: '小安' }, { id: 2, name: '小美' }, { id: 3, name: '阿哲' }],
    splitMode: 'mixed', diningItems: [{ id: 'food-1', name: '共享餐點', amount: 300, participantIds: [1, 2, 3] }],
    totalBill: 300, serviceChargeType: 'fixed', serviceChargeValue: 0, billPayerId: 1
};
const calculation = { finalTotal: 300, payerId: 1, results: [{ id: 1, amount: 100 }, { id: 2, amount: 100 }, { id: 3, amount: 100 }] };
const rows = [{ id: 'food-1', name: '共享餐點', amount: 300 }];
const legacyTrip = () => ({ people: [{ id: 11, name: '小安' }, { id: 12, name: '小美' }, { id: 13, name: '阿哲' }], days: 2, expenses: [] });
const build = (trip, day) => api.build(source, trip, {
    sourceProjectId: 'dining-demo', targetProjectId: 'travel-demo', expenseId: 'expense-demo',
    importedAt: '2026-11-18T01:00:00.000Z', mapping: { 1: '11', 2: '12', 3: '13' }, day
}, calculation, rows);

test('舊帳本沒有日序欄位時，原第 1／2 天仍可匯入，越界與非整數拒絕', () => {
    assert.equal(build(legacyTrip(), 1).day, 1);
    assert.equal(build(legacyTrip(), 2).day, 2);
    for (const invalid of [0, -1, 1.5, 3, NaN, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => build(legacyTrip(), invalid), /有效的天數/);
    }
});

test('刪除中間天數後，可匯入保留的穩定 slot，不能把已刪 slot 當顯示序號', () => {
    const trip = { ...legacyTrip(), dayOrder: [1, 4], daySequence: 4 };
    assert.equal(build(trip, 4).day, 4);
    assert.throws(() => build(trip, 2), /有效的天數/);
    assert.throws(() => build(trip, 3), /有效的天數/);
});

test('刪除原第 1 天後，不能以最小數值或舊範圍誤選已刪天數', () => {
    const trip = { ...legacyTrip(), dayOrder: [2, 7], daySequence: 7 };
    assert.equal(build(trip, 2).day, 2);
    assert.equal(build(trip, 7).day, 7);
    assert.throws(() => build(trip, 1), /有效的天數/);
});

test('日序還原或重排不改寫原 slot，金額／付款／個人負擔保持相同', () => {
    const trip = { ...legacyTrip(), dayOrder: [7, 2], daySequence: 7 };
    const before = structuredClone(trip), result = build(trip, 2);
    assert.equal(result.day, 2);
    assert.equal(result.amount, 300);
    assert.deepEqual(result.payers, { 11: 300 });
    assert.deepEqual(result.splitAmounts, { 11: 100, 12: 100, 13: 100 });
    assert.deepEqual(result.diningImport.rows, rows);
    assert.deepEqual(trip, before);
});

test('相同顯示天數但 active slots 已變更，指紋必須不同', () => {
    const first = { ...legacyTrip(), dayOrder: [1, 2], daySequence: 2 };
    const changed = { ...first, dayOrder: [1, 3], daySequence: 3 };
    assert.notEqual(api.targetFingerprint(first), api.targetFingerprint(changed));
});

test('相同 slots 但顯示順序不同，指紋必須不同', () => {
    const trip = { ...legacyTrip(), dayOrder: [2, 7], daySequence: 7 };
    assert.notEqual(api.targetFingerprint(trip), api.targetFingerprint({ ...trip, dayOrder: [7, 2] }));
});

test('日程序號增加但 active slots 不變，指紋仍會使舊核對失效', () => {
    const trip = { ...legacyTrip(), dayOrder: [1, 2], daySequence: 3 };
    assert.notEqual(api.targetFingerprint(trip), api.targetFingerprint({ ...trip, daySequence: 4 }));
});

test('舊帳本開始保存相同日序，不會因等價格式誤判更動', () => {
    const trip = legacyTrip();
    assert.equal(api.targetFingerprint(trip), api.targetFingerprint({ ...trip, dayOrder: [1, 2], daySequence: 2 }));
});

test('舊帳本 days 小於既有支出天數時，不會把既有有效天數隱藏', () => {
    const trip = { ...legacyTrip(), days: 1, expenses: [{ id: 'old', day: 3 }] };
    assert.equal(build(trip, 3).day, 3);
    assert.throws(() => build(trip, 4), /有效的天數/);
});

test('損壞、空白、重複日序會停止匯入，而非產生猜測的天數', () => {
    for (const dayOrder of [[], [1, 1], [0, 2], [1.5, 2], ['invalid'], null, '1,2']) {
        const trip = { ...legacyTrip(), dayOrder };
        assert.throws(() => api.targetFingerprint(trip), /旅遊/);
        assert.throws(() => build(trip, 1), /旅遊/);
    }
});

test('日序指紋與 build 不需 EntryRecycleBin 全域套件', () => {
    assert.equal(typeof global.EntryRecycleBin, 'undefined');
    assert.equal(typeof global.window, 'undefined');
    const trip = { ...legacyTrip(), dayOrder: [3], days: 1, daySequence: 3 };
    assert.equal(build(trip, 3).day, 3);
    assert.match(api.targetFingerprint(trip), /"dayOrder":\[3\]/);
});
