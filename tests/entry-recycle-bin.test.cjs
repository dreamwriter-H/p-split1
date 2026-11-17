'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { moveToBin, restore } = require('../entry-recycle-bin.js');
const actor = { uid: 'editor-1', displayName: '測試成員' };
const time = '2026-11-17T08:00:00.000Z';
const expense = { id: 12, desc: '晚餐', amount: 638, day: 2, payers: { a: 638 }, splitBetween: ['a', 'b'], splitAmounts: { a: 300, b: 338 }, receiptMeta: { currency: 'TWD' } };
const travel = () => ({ type: 'travel', data: { people: [{ id: 'a' }, { id: 'b' }], expenses: [structuredClone(expense)], days: 2, name: '旅遊' } });
const deleted = () => ({ ...travel(), data: moveToBin(travel(), expense, actor, 'token-1', time) });

test('刪除完整保留原資料、刪除者與時間；還原金額、付款、分攤及收據完全相同', () => {
    const original = travel(), before = structuredClone(original);
    const data = moveToBin(original, expense, actor, 'token-1', time);
    assert.deepEqual(original, before);
    assert.equal(data.expenses.length, 0);
    assert.deepEqual(data.recycleBin[0], { id: 'token-1', collection: 'expenses', item: expense, deletedAt: time, deletedBy: actor.uid, deletedByName: actor.displayName });
    const restored = restore({ ...original, data }, 'token-1');
    assert.deepEqual(restored.expenses, original.data.expenses);
    assert.deepEqual(restored.recycleBin, []);
    assert.deepEqual(data.recycleBin[0].item, expense);
});

test('舊聚餐無回收桶／負擔人欄位仍能刪除與還原；不更動總額模式與其他品項', () => {
    const item = { id: 'food', name: '折扣', amount: -50 };
    const project = { type: 'dining', data: { people: [], totalBill: 1000, splitMode: 'mixed', diningItems: [item, { id: 'other', amount: 100 }] } };
    const data = moveToBin(project, { ...item, participantIds: [] }, actor, 'dining-1', time);
    assert.equal(data.totalBill, 1000);
    assert.equal(data.diningItems.length, 1);
    assert.deepEqual(restore({ ...project, data }, 'dining-1').diningItems, [project.data.diningItems[1], item]);
});

test('舊支出未設定天數，可比對畫面預設天數且完整保存原始欄位', () => {
    const project = travel(); delete project.data.expenses[0].day;
    const result = moveToBin(project, { ...project.data.expenses[0], day: 1 }, actor, 'legacy', time);
    assert.equal(Object.hasOwn(result.recycleBin[0].item, 'day'), false);
});

test('確認期間被修改／刪除時擋下，不刪掉最新內容', () => {
    const project = travel(); project.data.expenses[0].amount = 700;
    assert.throws(() => moveToBin(project, expense, actor, 'token', time), /已被其他成員修改/);
    assert.equal(project.data.expenses[0].amount, 700);
    assert.throws(() => moveToBin(deleted(), expense, actor, 'other', time), /已不存在/);
});

test('Firestore map 欄位順序不同不誤判內容變更', () => {
    const expected = Object.fromEntries(Object.entries(expense).reverse());
    assert.equal(moveToBin(travel(), expected, actor, 'token', time).recycleBin.length, 1);
});

test('交易重試保留其他人新增的支出與回收紀錄；同筆重刪或重還原只生效一次', () => {
    const latest = deleted();
    latest.data.expenses.push({ ...expense, id: 13, desc: '交通' });
    const next = moveToBin(latest, latest.data.expenses[0], actor, 'token-2', time);
    assert.equal(next.recycleBin.length, 2);
    const restored = restore({ ...latest, data: next }, 'token-1');
    assert.equal(restored.recycleBin.length, 1);
    assert.equal(restored.expenses[0].desc, '晚餐');
    assert.throws(() => restore({ ...latest, data: restored }, 'token-1'), /已還原/);
});

test('還原遇到付款人或負擔成員已移除、同識別碼存在，保留回收紀錄', () => {
    const project = deleted(); project.data.people = [{ id: 'a' }];
    assert.throws(() => restore(project, 'token-1'), /成員已被移除/);
    assert.equal(project.data.recycleBin.length, 1);
    const collision = deleted(); collision.data.expenses.push({ ...expense, id: '12' });
    assert.throws(() => restore(collision, 'token-1'), /相同識別碼/);
});

test('聚餐匯入支出可以完整復原，但已重新匯入時不可重複計帳', () => {
    const project = travel(); project.data.expenses[0].diningImport = { sourceProjectId: 'dinner', shares: [{ personId: 'a', amount: 300 }] };
    const data = moveToBin(project, project.data.expenses[0], actor, 'import', time);
    assert.deepEqual(restore({ ...project, data }, 'import').expenses, project.data.expenses);
    data.expenses.push({ ...project.data.expenses[0], id: 'new-import' });
    assert.throws(() => restore({ ...project, data }, 'import'), /已重新匯入/);
});

test('回收桶滿與資料量過大時不刪資料；不自動淘汰最舊紀錄', () => {
    const project = travel(); project.data.recycleBin = Array.from({ length: 50 }, (_, id) => ({ id }));
    assert.throws(() => moveToBin(project, expense, actor, 'new', time), /已達 50 筆/);
    assert.equal(project.data.expenses.length, 1);
    assert.equal(project.data.recycleBin.length, 50);
    const large = travel(); large.data.note = '測'.repeat(250000);
    assert.throws(() => moveToBin(large, expense, actor, 'large', time), /資料量已偏大/);
    assert.equal(large.data.expenses.length, 1);
});

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const operationsSource = html.slice(html.indexOf('const COLLAB_ENTITY_ARRAY_KEYS'), html.indexOf('const getProjectDisplayName'));
const { buildDataOperations, applyDataOperations } = vm.runInNewContext(operationsSource + '\n({buildDataOperations, applyDataOperations})');
const plain = value => JSON.parse(JSON.stringify(value));

test('延遲送出的欄位修改不會復活已刪除的支出或品項', () => {
    for (const key of ['expenses', 'diningItems']) {
        const operations = buildDataOperations({ [key]: [{ id: 1, amount: 50 }] }, { [key]: [{ id: 1, amount: 100 }] });
        const latest = { [key]: [], recycleBin: [{ id: 'retained' }] };
        assert.deepEqual(plain(applyDataOperations(latest, operations)), latest);
    }
});

test('其他成員的欄位修改會保留交易新增的回收桶', () => {
    const base = travel().data;
    const operations = buildDataOperations(base, { ...base, name: '新名稱' });
    const latest = deleted().data;
    const result = plain(applyDataOperations(latest, operations));
    assert.equal(result.name, '新名稱');
    assert.deepEqual(result.recycleBin, latest.recycleBin);
    assert.deepEqual(result.expenses, []);
});

// Exercise the production App handler with an in-memory transaction adapter.
// This does not replace Firebase authorization or real multi-account testing.
function appHarness(options = {}) {
    let project = { id: 'project-1', ownerId: 'owner', ...travel() };
    const messages = [], events = [], pending = { current: options.pending || null };
    const active = { current: project }, busy = { current: false };
    const context = {
        recycleBusyRef: busy, setRecycleBusy: value => events.push(['busy', value]),
        auth: { currentUser: options.signedOut ? null : actor }, activeProjectRef: active,
        syncInFlightRef: { current: !!options.syncInFlight },
        debounceTimer: { current: null }, pendingProjectUpdateRef: pending,
        flushPendingProjectUpdate: async () => { events.push(['flush']); },
        createInviteToken: () => 'new-token', db: {}, projectRefFor: id => id,
        window: { SplitEasyRecycleBin: { moveToBin, restore } },
        runTransaction: async (_, callback) => {
            events.push(['transaction']);
            if (options.denied) throw new Error('permission-denied');
            const writes = [];
            const result = await callback({
                get: async () => ({ exists: () => !options.missing, data: () => structuredClone(project), id: project.id }),
                set: (_, next) => writes.push(next)
            });
            project = { ...writes[0], id: project.id };
            return result;
        },
        setActiveProjectData: value => events.push(['display', value]),
        setProjects: updater => updater([project]),
        showMessage: message => messages.push(message),
        console: { error() {} }, Date
    };
    const source = html.slice(html.indexOf('const changeRecycleBin ='), html.indexOf('const requestEntryDelete ='));
    const change = vm.runInNewContext(source + '\nchangeRecycleBin;', context);
    return { change, messages, events, pending, active, busy, project: () => project };
}

test('App 正式處理器先同步再交易，刪除與還原結果寫回畫面並留下操作者', async () => {
    const app = appHarness();
    await app.change('project-1', 'delete', expense);
    assert.equal(app.project().data.expenses.length, 0);
    assert.equal(app.project().lastUpdatedBy, actor.uid);
    assert.equal(app.messages[0].title, '已移至回收桶');
    assert.ok(app.events.findIndex(event => event[0] === 'flush') < app.events.findIndex(event => event[0] === 'transaction'));
    await app.change('project-1', 'restore', 'new-token');
    assert.deepEqual(app.project().data.expenses, [expense]);
    assert.equal(app.messages[1].title, '已還原紀錄');
    assert.equal(app.busy.current, false);
});

test('App 斷線未同步、同步中、登出或切換專案時不執行刪除交易', async () => {
    for (const options of [{ pending: { operations: [{}] } }, { syncInFlight: true }, { signedOut: true }]) {
        const app = appHarness(options);
        await app.change('project-1', 'delete', expense);
        assert.equal(app.events.some(event => event[0] === 'transaction'), false);
        assert.equal(app.project().data.expenses.length, 1);
        assert.equal(app.messages[0].title, '操作未完成');
        assert.equal(app.busy.current, false);
    }
    const app = appHarness();
    await app.change('other-project', 'delete', expense);
    assert.equal(app.events.some(event => event[0] === 'transaction'), false);
});

test('App 交易權限拒絕或專案不存在時不顯示成功、不清除原紀錄', async () => {
    for (const options of [{ denied: true }, { missing: true }]) {
        const app = appHarness(options);
        await app.change('project-1', 'delete', expense);
        assert.equal(app.messages[0].title, '操作未完成');
        assert.equal(app.project().data.expenses.length, 1);
        assert.equal(app.project().data.recycleBin, undefined);
        assert.equal(app.busy.current, false);
    }
});
