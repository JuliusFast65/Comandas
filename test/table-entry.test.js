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
    lastWorkedOrder: null, state: { orders: [] }, menus: new Map(), createdOrders: new Map(),
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

test("los toques rápidos se guardan en orden y con la versión vigente", async () => {
  const source = await readFile(new URL("../scripts.js", import.meta.url), "utf8");
  const requests = [], workspace = { setAttribute() {}, removeAttribute() {} };
  // Minimal server: each saved change increases the version of the order.
  const saved = { id: "order", version: 4, items: [{ id: "item", status: "draft", quantity: 1, note: "" }] };
  const context = vm.createContext({
    pendingRuns: 0, runQueue: Promise.resolve(), busy: false, pendingTable: null, selected: null,
    state: { orders: [structuredClone(saved)] }, menus: new Map(), createdOrders: new Map(),
    $: () => workspace, message() {}, render() {},
    refresh: async () => { context.state = { orders: [structuredClone(saved)] }; },
    api: async (path, body) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      requests.push({ path, body });
      if (path === "/orders") {
        Object.assign(saved, { id: "created", version: 1 });
        return { id: "created" };
      }
      if (body.version !== saved.version) throw new Error("conflicto");
      saved.version++;
      if (body.action === "edit") saved.items[0].quantity = body.quantity;
      if (body.action === "remove") saved.items = [];
      return { ok: true };
    },
  });
  vm.runInContext(source.slice(source.indexOf("function run("), source.indexOf("function navigate(")), context);
  const order = context.state.orders[0];
  const more = (current) => {
    const item = current.items.find((i) => i.id === "item");
    return item ? { itemId: item.id, quantity: item.quantity + 1, note: item.note } : null;
  };
  // Three taps on the same button before the first one is answered.
  const taps = [context.action(order, "edit", more), context.action(order, "edit", more), context.action(order, "edit", more)];
  // A different operation during that time is still ignored, as a double-submit guard.
  assert.equal(await context.action(order, "send"), false);
  assert.deepEqual(await Promise.all(taps), [true, true, true]);
  assert.deepEqual(requests.map((r) => [r.body.version, r.body.quantity]), [[4, 2], [5, 3], [6, 4]]);
  assert.equal(context.busy, false);
  // Removing twice sends one request; the second tap finds nothing to remove.
  const gone = (current) => current.items.some((i) => i.id === "item") ? { itemId: "item" } : null;
  await Promise.all([context.action(order, "remove", gone), context.action(order, "remove", gone)]);
  assert.equal(requests.filter((r) => r.body.action === "remove").length, 1);

  // Two taps on a free table create one order; the second product is added to it.
  requests.length = 0;
  const pending = { id: "pending-table-3", pending: true, table_number: 3, waiter_id: "w", version: 0, items: [], accounts: [] };
  const product = { productId: "dish", quantity: 1, account: 1, note: "" };
  await Promise.all([context.action(pending, "add", product), context.action(pending, "add", product)]);
  assert.deepEqual(requests.map((r) => r.path), ["/orders", "/orders/created/actions"]);
  assert.equal(requests[1].body.version, 1);
});
