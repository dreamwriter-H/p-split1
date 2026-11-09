"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const helpers = vm.runInNewContext([
  section("const COLLAB_ENTITY_ARRAY_KEYS", "const getProjectDisplayName"),
  section("const formatMoney", "// --- 旅遊結算邏輯 ---"),
  section("// 舊帳本沒有 payerId", "// --- UI 元件 ---"),
  "({ normalizeDiningWalletPeople, changeDiningWallet, getDiningWalletGroups, calculateDiningResult, buildDataOperations, applyDataOperations })",
].join("\n"), { Intl, console });
const { normalizeDiningWalletPeople: normalize, changeDiningWallet: change, calculateDiningResult: calculate } = helpers;
const plain = value => JSON.parse(JSON.stringify(value));
const base = {
  title: "週末聚餐", people: [1, 2, 3, 4].map(id => ({ id, name: `成員${id}`, payerId: id })),
  splitMode: "even", totalBill: 1000, serviceChargeType: "percent", serviceChargeValue: 10,
  customAmounts: {}, diningItems: [], billPayerId: 1,
};
const grouped = () => change(change(base.people, 2, 1), 4, 3);
let count = 0;
function test(name, run) { run(); count++; console.log(`PASS ${name}`); }
function checkConservation(result) {
  assert.equal(result.results.reduce((sum, r) => sum + r.amount, 0), result.finalTotal);
  assert.equal(result.wallets.reduce((sum, r) => sum + r.amount, 0), result.finalTotal);
  assert.ok(result.transfers.every(t => t.fromId !== t.toId && Number.isInteger(t.amount) && t.amount > 0));
  result.wallets.filter(wallet => wallet.id !== result.payerWalletId).forEach(wallet => {
    const outgoing = result.transfers.filter(t => t.fromId === wallet.id).reduce((sum, t) => sum + t.amount, 0);
    const incoming = result.transfers.filter(t => t.toId === wallet.id).reduce((sum, t) => sum + t.amount, 0);
    assert.equal(outgoing - incoming, wallet.amount);
  });
}

test("舊帳本沒有錢包欄位時維持逐人結算", () => {
  const result = calculate({ ...base, people: base.people.map(({ payerId, ...p }) => p) });
  assert.deepEqual(plain(result.results.map(r => r.amount)), [275, 275, 275, 275]);
  assert.deepEqual(plain(result.transfers.map(t => [t.fromId, t.toId, t.amount])), [[2, 1, 275], [3, 1, 275], [4, 1, 275]]);
  checkConservation(result);
});
test("均攤與服務費先按人數計算，再合併兩組錢包", () => {
  const result = calculate({ ...base, people: grouped() });
  assert.deepEqual(plain(result.wallets.map(w => w.amount)), [550, 550]);
  assert.deepEqual(plain(result.transfers.map(t => [t.fromId, t.toId, t.amount])), [[3, 1, 550]]);
  checkConservation(result);
});
test("同組成員先付款時，對外收款仍歸錢包代表", () => {
  const result = calculate({ ...base, people: grouped(), billPayerId: 2 });
  assert.equal(result.payerId, 2);
  assert.equal(result.payerWalletId, 1);
  assert.deepEqual(plain(result.transfers.map(t => [t.fromId, t.toId, t.amount])), [[3, 1, 550]]);
  checkConservation(result);
});
for (const serviceChargeType of ["percent", "fixed"]) {
  test(`個別套餐與${serviceChargeType === "fixed" ? "固定" : "百分比"}服務費維持個人比例`, () => {
    const result = calculate({ ...base, people: grouped(), splitMode: "custom", customAmounts: { 1: 100, 2: 200, 3: 300, 4: 400 }, serviceChargeType, serviceChargeValue: serviceChargeType === "fixed" ? 100 : 10, billPayerId: 3 });
    assert.deepEqual(plain(result.results.map(r => r.amount)), [110, 220, 330, 440]);
    assert.deepEqual(plain(result.transfers.map(t => [t.fromId, t.toId, t.amount])), [[1, 3, 330]]);
    checkConservation(result);
  });
}
test("共享、指定與個人品項維持原分攤範圍", () => {
  const result = calculate({ ...base, people: grouped(), billPayerId: 4, splitMode: "mixed", diningItems: [
    { id: "a", name: "共享餐點", amount: 600, participantIds: [1, 2, 3, 4] },
    { id: "b", name: "個人主餐", amount: 200, participantIds: [2] },
    { id: "c", name: "雙人甜點", amount: 100, participantIds: [3, 4] },
  ] });
  assert.deepEqual(plain(result.results.map(r => r.amount)), [165, 385, 220, 220]);
  assert.deepEqual(plain(result.wallets.map(w => w.amount)), [550, 440]);
  assert.equal(result.transfers[0].amount, 550);
  checkConservation(result);
});
test("折扣品項與固定服務費在分組前後一致", () => {
  const data = { ...base, splitMode: "mixed", serviceChargeType: "fixed", serviceChargeValue: 53, diningItems: [
    { id: "a", amount: 1000, participantIds: [1, 2, 3, 4] },
    { id: "b", amount: -100, participantIds: [1, 2, 3, 4] },
  ] };
  const result = calculate({ ...data, people: grouped() });
  assert.equal(result.finalTotal, 953);
  assert.deepEqual(plain(result.results), plain(calculate(data).results));
  checkConservation(result);
});
test("負淨額錢包由付款錢包代表退款，實際付款人可為同組成員", () => {
  const result = calculate({ ...base, people: grouped(), billPayerId: 2, splitMode: "mixed", serviceChargeType: "fixed", serviceChargeValue: 0, diningItems: [
    { id: "a", amount: 200, participantIds: [1] },
    { id: "b", amount: 10, participantIds: [3] },
    { id: "c", amount: -20, participantIds: [4] },
  ] });
  assert.equal(result.finalTotal, 190);
  assert.equal(result.payerId, 2);
  assert.equal(result.payerWalletId, 1);
  assert.deepEqual(plain(result.results.map(r => r.amount)), [200, 0, 10, -20]);
  assert.deepEqual(plain(result.wallets.map(w => w.amount)), [200, -10]);
  assert.deepEqual(plain(result.transfers), [{ fromId: 1, toId: 3, from: "成員1", to: "成員3", amount: 10 }]);
  checkConservation(result);
});
test("整數尾差在合併前分配，總額精確守恆", () => {
  const people = change(base.people.slice(0, 3), 2, 1);
  const result = calculate({ ...base, people, totalBill: 100, serviceChargeValue: 0 });
  assert.deepEqual(plain(result.results.map(r => r.amount)), [34, 33, 33]);
  assert.deepEqual(plain(result.wallets.map(w => w.amount)), [67, 33]);
  assert.equal(result.transfers[0].amount, 33);
  checkConservation(result);
});
test("所有人共用同一錢包時不列內部轉帳", () => {
  const people = [2, 3, 4].reduce((p, id) => change(p, id, 1), base.people);
  const result = calculate({ ...base, people, billPayerId: 4 });
  assert.equal(result.wallets.length, 1);
  assert.equal(result.wallets[0].amount, 1100);
  assert.equal(result.transfers.length, 0);
  checkConservation(result);
});
test("退出錢包、整組合併與刪除代表都不遺漏成員", () => {
  const detached = change(grouped(), 2, 2);
  assert.deepEqual(plain(detached.map(p => p.payerId)), [1, 2, 3, 3]);
  const merged = change(grouped(), 1, 3);
  assert.deepEqual(plain(merged.map(p => p.payerId)), [3, 3, 3, 3]);
  const removed = normalize(grouped().filter(p => p.id !== 1));
  assert.deepEqual(plain(removed.map(p => p.payerId)), [2, 3, 3]);
  const result = calculate({ ...base, people: removed });
  assert.equal(result.payerId, 2);
  checkConservation(result);
});
test("失效、循環與巢狀舊關係不造成白頁或遺失金額", () => {
  assert.deepEqual(plain(normalize([{ id: 1, payerId: 2 }, { id: 2, payerId: 1 }]).map(p => p.payerId)), [1, 2]);
  assert.deepEqual(plain(normalize([{ id: 1, payerId: 2 }, { id: 2, payerId: 3 }, { id: 3 }]).map(p => p.payerId)), [3, 3, 3]);
  assert.equal(normalize([{ id: 1, payerId: 99 }])[0].payerId, 1);
});
test("重新載入保留分組，共編別人的名稱時保留錢包異動", () => {
  const data = { ...base, people: grouped() };
  assert.deepEqual(plain(calculate(JSON.parse(JSON.stringify(data)))), plain(calculate(data)));
  const operations = helpers.buildDataOperations(base, { ...base, people: change(base.people, 2, 1) });
  const remote = { ...base, people: base.people.map(p => p.id === 2 ? { ...p, name: "新名字" } : p) };
  const merged = helpers.applyDataOperations(remote, operations);
  assert.equal(merged.people[1].name, "新名字");
  assert.equal(merged.people[1].payerId, 1);
});
test("多種金額與分組的個人負擔一致且總額守恆", () => {
  for (const totalBill of [1, 2, 100, 100.5, 999.99, 12345]) {
    for (const serviceChargeValue of [0, 5, 10]) {
      const ungrouped = calculate({ ...base, totalBill, serviceChargeValue });
      const result = calculate({ ...base, people: grouped(), totalBill, serviceChargeValue });
      assert.deepEqual(plain(result.results), plain(ungrouped.results));
      checkConservation(result);
    }
  }
});
console.log(`DINING_WALLET_TESTS_OK ${count}`);
