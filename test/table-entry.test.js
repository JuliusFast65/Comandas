import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("entrar y salir de una mesa libre no guarda ni asigna una orden", async () => {
  const source = await readFile(new URL("../scripts.js", import.meta.url), "utf8");
  const requests = [];
  const context = vm.createContext({
    pendingTable: null, selected: null, activeWaiter: "waiter-1",
    lastWorkedOrder: null, state: { orders: [] }, menus: new Map(),
    summaryOf: () => ({}), el: () => ({}),
    button: (_label, click) => ({ click, append() {}, classList: { add() {} } }),
    navigate: (_view, id = null) => { context.selected = id; },
    api: async (path, body) => { requests.push({ path, body }); return { id: "saved" }; },
    run: (fn) => fn(),
  });
  const card = source.slice(source.indexOf("function tableCard("), source.indexOf("function renderTables("));
  const action = source.slice(source.indexOf("function action("), source.indexOf("function navigate("));
  vm.runInContext(card + action, context);
  context.tableCard(3, null).click();
  assert.equal(requests.length, 0);
  assert.equal(context.pendingTable.items.length, 0);
  context.navigate("mesas");
  assert.equal(requests.length, 0);
  context.tableCard(3, null).click();
  await context.action(context.pendingTable, "add", { productId: "dish", quantity: 1, account: 1, note: "" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/orders");
  assert.equal(requests[0].body.tableNumber, 3);
  assert.equal(requests[0].body.firstItem.productId, "dish");
  assert.equal(context.selected, "saved");
  assert.equal(context.pendingTable, null);
});
