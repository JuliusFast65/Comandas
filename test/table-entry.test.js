import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("Ocupar mesa se deshabilita con productos y se habilita cuando queda vacía", async () => {
  const source = await readFile(new URL("../scripts.js", import.meta.url), "utf8");
  const start = source.indexOf("function renderOrder(");
  const end = source.indexOf("  if (!confirming) {", start);
  const buttons = [];
  const context = vm.createContext({
    confirming: false, lastWorkedOrder: null,
    menu: () => ({}), editableOrder: () => true, orderTitle: () => "Mesa 3",
    heading: () => ({}), el: () => ({ append() {} }), action() {},
    button: (label, click, disabled = false) => {
      const b = { label, click, disabled };
      buttons.push(b);
      return b;
    },
  });
  vm.runInContext(source.slice(start, end) + "}", context);
  for (const status of ["draft", "preparing", "ready"]) {
    buttons.length = 0;
    context.renderOrder({}, { id: "order", table_number: 3, status: "open", occupied_explicitly: false, items: [{ status }] });
    assert.equal(buttons.find((b) => b.label === "Ocupar mesa").disabled, true);
  }
  buttons.length = 0;
  context.renderOrder({}, { id: "pending", pending: true, table_number: 3, status: "open", items: [] });
  assert.equal(buttons.find((b) => b.label === "Ocupar mesa").disabled, false);
});

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
  context.tableCard(4, null).click();
  await context.action(context.pendingTable, "occupy");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.tableNumber, 4);
  assert.equal(requests[1].body.occupiedExplicitly, true);
  assert.equal(requests[1].body.firstItem, undefined);
});
