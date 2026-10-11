import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { readFile } from "node:fs/promises";

let admin, pool, app, server, base;
const databaseClients = new Set();
const database = `comandas_test_${randomUUID().replaceAll("-", "")}`;
const password = "integration-only-password";
before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
  admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  process.env.DATABASE_URL = url.href;
  const init = spawnSync(process.execPath, ["server/init.js"], {
    env: { ...process.env, SEED_PASSWORD: password },
    encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);
  ({ pool } = await import("../server/db.js"));
  ({ app } = await import("../server/app.js"));
  pool.on("connect", (client) => {
    databaseClients.add(client);
    client.once("end", () => databaseClients.delete(client));
  });
  await start();
});

test("preparación por asignaciones independientes del rol y revocación en sesión", async () => {
  const waiter = client(), second = client(), kitchen = client();
  const owner = await waiter.login("mesero");
  const operator = await second.login("mesero2");
  const cook = await kitchen.login("cocina");
  assert.equal(cook.role, "estacion");
  assert.deepEqual(cook.stations, ["cocina"]);
  const state = await waiter.request("/api/state");
  assert.deepEqual(state.stations.map((s) => s.code), ["bar", "cocina"]);
  const created = await waiter.request("/api/orders", {}, 201);
  async function current() {
    return (await waiter.request("/api/state")).orders.find((o) => o.id === created.id);
  }
  async function perform(c, action, fields = {}, expected = 200) {
    return c.request(`/api/orders/${created.id}/actions`, {
      action, version: (await current()).version, ...fields,
    }, expected);
  }
  for (const area of ["cocina", "bar"]) {
    await perform(waiter, "add", {
      productId: state.products.find((p) => p.area === area).id,
      quantity: 1, account: 1, note: "",
    });
  }
  await perform(waiter, "send");
  const items = (await current()).items;
  const food = items.find((i) => i.area === "cocina");
  const drink = items.find((i) => i.area === "bar");
  await perform(second, "ready", { itemId: food.id }, 403);
  try {
    await pool.query("INSERT INTO user_stations(user_id,station_code) VALUES($1,'cocina'),($1,'bar')", [operator.id]);
    assert.deepEqual((await second.request("/api/me")).stations, ["bar", "cocina"]);
    // Preparation is permitted even when the order belongs to a different waiter.
    assert.notEqual(operator.waiter_id, owner.waiter_id);
    await perform(second, "ready", { itemId: food.id });
    await perform(second, "ready", { itemId: drink.id });
    await perform(second, "edit", { itemId: food.id, quantity: 2, account: 1, note: "" }, 403);
    await pool.query("DELETE FROM user_stations WHERE user_id=$1 AND station_code='bar'", [operator.id]);
    await perform(second, "ready", { itemId: drink.id, ready: false }, 403);
    await pool.query("UPDATE stations SET active=false WHERE code='cocina'");
    assert.deepEqual((await second.request("/api/me")).stations, []);
    await perform(second, "ready", { itemId: food.id, ready: false }, 403);
  } finally {
    await pool.query("UPDATE stations SET active=true WHERE code='cocina'");
    await pool.query("DELETE FROM user_stations WHERE user_id=$1", [operator.id]);
  }
});

test("migración de roles anteriores conserva datos y no repone asignaciones revocadas", async () => {
  // Recreate the pre-v5 structure only in the disposable integration database.
  await pool.query(`
    ALTER TABLE products DROP CONSTRAINT products_station_fk;
    ALTER TABLE order_items DROP CONSTRAINT order_items_station_fk;
    DROP TABLE user_stations;
    DROP TABLE stations;
    DELETE FROM schema_migrations WHERE version=5;
    ALTER TABLE users DROP CONSTRAINT users_role_check;
    UPDATE users SET role=username WHERE username IN ('cocina','bar');
  `);
  const schema = await readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
  const preservedTables = ["products", "orders", "order_items", "order_accounts", "order_events", "sessions", "waiters", "app_settings"];
  async function snapshot() {
    const result = {};
    for (const table of preservedTables) {
      result[table] = (await pool.query(`SELECT row_to_json(t) AS data FROM ${table} t ORDER BY row_to_json(t)::text`)).rows;
    }
    return result;
  }
  const before = await snapshot();
  const usersBefore = (await pool.query("SELECT * FROM users ORDER BY id")).rows;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(schema);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual((await pool.query("SELECT * FROM users ORDER BY id")).rows,
    usersBefore.map((u) => ({ ...u, role: ["cocina", "bar"].includes(u.role) ? "estacion" : u.role })));
  const assignments = (await pool.query("SELECT u.username,us.station_code FROM user_stations us JOIN users u ON u.id=us.user_id ORDER BY u.username")).rows;
  assert.deepEqual(assignments, [
    { username: "bar", station_code: "bar" },
    { username: "cocina", station_code: "cocina" },
  ]);
  await pool.query("DELETE FROM user_stations WHERE station_code='bar'");
  const init = spawnSync(process.execPath, ["server/init.js"], {
    env: { ...process.env, SEED_PASSWORD: password }, encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);
  assert.equal((await pool.query("SELECT * FROM user_stations WHERE station_code='bar'")).rowCount, 0);
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(pool.query("UPDATE products SET area='inexistente' WHERE id=(SELECT id FROM products LIMIT 1)"), { code: "23503" });
  await pool.query("INSERT INTO user_stations(user_id,station_code) SELECT id,'bar' FROM users WHERE username='bar'");
});
async function start() {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.APP_ORIGIN = base;
}
async function stop() {
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections();
  await closed;
}
after(async () => {
  if (server) await stop();
  if (pool) {
    // pg-pool resolves end() before idle sockets necessarily finish closing.
    const closed = [...databaseClients].map(
      (client) => new Promise((resolve) => client.once("end", resolve)),
    );
    await pool.end();
    await Promise.all(closed);
  }
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});
function client() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async request(path, body, expected = 200) {
      const response = await fetch(base + path, {
        headers: {
          Cookie: cookie,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined
          ? { method: "POST", body: JSON.stringify(body) }
          : {}),
      });
      const set = response.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      return data;
    },
    login(role) {
      return this.request("/api/login", { username: role, password });
    },
  };
}
test("flujo compartido, permisos, concurrencia e historial en PostgreSQL", async (t) => {
  const mesero = client(),
    cocina = client(),
    bar = client(),
    caja = client(),
    other = client(),
    administrator = client(),
    auditor = client(),
    secondWaiter = client();
  let orderId, food, drink;
  async function order(c = mesero) {
    return (await c.request("/api/state")).orders.find((o) => o.id === orderId);
  }
  async function action(c, name, fields = {}, expected = 200) {
    const current = await order(c);
    return c.request(
      `/api/orders/${orderId}/actions`,
      { action: name, version: current.version, ...fields },
      expected,
    );
  }
  await t.test(
    "sesiones separadas y rechazo de accesos no autorizados",
    async () => {
      await other.request("/api/state", undefined, 401);
      await other.request(
        "/api/login",
        { username: "mesero", password: "incorrecta" },
        401,
      );
      await Promise.all([
        mesero.login("mesero"),
        cocina.login("cocina"),
        bar.login("bar"),
        caja.login("caja"),
        administrator.login("admin"),
        auditor.login("auditor"),
        secondWaiter.login("mesero2"),
      ]);
      assert.equal((await cocina.request("/api/me")).role, "estacion");
      await cocina.request("/api/orders", { tableNumber: 1 }, 403);
      await mesero.request("/api/history", undefined, 403);
      await auditor.request("/api/orders", {}, 403);
      await mesero.request("/api/config", { version: 0, config: {} }, 403);
      await caja.request("/api/users", undefined, 403);
      const response = await fetch(base + "/api/orders", {
        method: "POST",
        headers: {
          Cookie: mesero.cookie,
          "Content-Type": "application/json",
          Origin: "https://another.example",
        },
        body: "{}",
      });
      assert.equal(response.status, 403);
      const malformed = await fetch(base + "/api/orders", {
        method: "POST",
        headers: { Cookie: mesero.cookie, "Content-Type": "application/json" },
        body: "{",
      });
      assert.equal(malformed.status, 400);
      const leaked = await fetch(base + "/server/schema.sql");
      assert.equal(leaked.status, 404);
    },
  );
  await t.test(
    "una sola orden por mesa y productos identificados individualmente",
    async () => {
      const created = await mesero.request(
        "/api/orders",
        { tableNumber: 1 },
        201,
      );
      orderId = created.id;
      await mesero.request("/api/orders", { tableNumber: 1 }, 409);
      await mesero.request("/api/orders", { tableNumber: 999 }, 400);
      const state = await mesero.request("/api/state");
      food = state.products.find((p) => p.name === "Pizza");
      drink = state.products.find((p) => p.name === "Agua");
      await action(mesero, "add", {
        productId: food.id,
        quantity: 2,
        account: 1,
        note: "Sin cebolla",
      });
      await action(mesero, "add", {
        productId: drink.id,
        quantity: 1,
        account: 2,
        note: "",
      });
      assert.equal((await order(cocina)).items.length, 2);
      await action(
        mesero,
        "add",
        { productId: food.id, quantity: -1, account: 1, note: "" },
        400,
      );
    },
  );
  await t.test("control de versiones y cambios concurrentes", async () => {
    const current = await order();
    const body = {
      action: "add",
      version: current.version,
      productId: food.id,
      quantity: 1,
      account: 1,
      note: "Otra porción",
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        fetch(`${base}/api/orders/${orderId}/actions`, {
          method: "POST",
          headers: {
            Cookie: mesero.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const after = await order();
    assert.equal(after.items.length, 3);
    const extra = after.items.find((i) => i.note === "Otra porción");
    await action(mesero, "remove", { itemId: extra.id });
    const pizza = (await order()).items.find((i) => i.area === "cocina");
    await action(mesero, "edit", {
      itemId: pizza.id,
      quantity: 3,
      note: "Sin cebolla",
    });
  });
  await t.test("cuentas y privacidad de datos del cliente", async () => {
    await action(mesero, "account", {
      account: 1,
      name: "Ana",
      customer: {
        name: "Ana Prueba",
        identification: "123",
        email: "ana@example.com",
      },
    });
    assert.equal(
      (await order(caja)).accounts.find((a) => a.number === 1).customer.name,
      "Ana Prueba",
    );
    assert.equal(
      (await order(cocina)).accounts.find((a) => a.number === 1).customer,
      undefined,
    );
    assert.equal(
      (await order(secondWaiter)).accounts.find((a) => a.number === 1).customer,
      undefined,
    );
    await action(
      secondWaiter,
      "account",
      { account: 1, name: "Otra persona", customer: {} },
      403,
    );
    await action(auditor, "bill", {}, 403);
  });
  await t.test("notificaciones PostgreSQL y conexión de eventos", async () => {
    const listener = await pool.connect();
    await listener.query("LISTEN comandas_changed");
    const notified = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("No notification")),
        3000,
      );
      listener.once("notification", (n) => {
        clearTimeout(timer);
        resolve(n);
      });
    });
    try {
      await action(mesero, "send");
      assert.equal((await notified).channel, "comandas_changed");
    } finally {
      await listener.query("UNLISTEN comandas_changed");
      listener.release();
    }
    const abort = new AbortController();
    const response = await fetch(base + "/api/events", {
      headers: { Cookie: cocina.cookie },
      signal: abort.signal,
    });
    assert.equal(
      response.headers.get("content-type"),
      "text/event-stream; charset=utf-8",
    );
    const reader = response.body.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /event: changed/,
    );
    abort.abort();
  });
  await t.test(
    "preparación por área y cierre solo al terminar ambos productos",
    async () => {
      const current = await order();
      const pizza = current.items.find((i) => i.area === "cocina"),
        water = current.items.find((i) => i.area === "bar");
      await action(mesero, "ready", { itemId: pizza.id }, 403);
      await action(cocina, "ready", { itemId: water.id }, 403);
      await action(mesero, "remove", { itemId: pizza.id }, 409);
      await action(mesero, "bill");
      await action(caja, "bill_delivered", { account: 1 }, 403);
      await action(mesero, "documents_received", { account: 1 }, 403);
      await action(mesero, "collected", { account: 1 }, 409);
      await action(caja, "documents_received", { account: 1 }, 409);
      await action(mesero, "bill_delivered", { account: 99 }, 404);
      await action(secondWaiter, "bill_delivered", { account: 1 }, 403);
      await action(mesero, "bill_delivered", { account: 1 });
      const delivered = (await order()).accounts.find((a) => a.number === 1).collection.bill_delivered;
      await action(mesero, "bill_delivered", { account: 1 });
      assert.deepEqual((await order()).accounts.find((a) => a.number === 1).collection.bill_delivered, delivered);
      await action(mesero, "collected", { account: 1 });
      await action(caja, "documents_received", { account: 1 });
      assert.ok((await order(caja)).accounts.find((a) => a.number === 1).collection.documents_received.at);
      await action(caja, "close", {}, 409);
      await action(cocina, "ready", { itemId: pizza.id });
      await action(cocina, "ready", { itemId: pizza.id, ready: false });
      await action(cocina, "ready", { itemId: pizza.id });
      await action(cocina, "pickup", { itemId: pizza.id, quantity: 1 }, 403);
      await action(mesero, "pickup", { itemId: water.id, quantity: 1 }, 409);
      await action(mesero, "pickup", { itemId: pizza.id, quantity: 0 }, 400);
      await action(mesero, "pickup", { itemId: pizza.id, quantity: 4 }, 400);
      await action(mesero, "pickup", { itemId: pizza.id, quantity: 1 });
      assert.equal(
        (await order()).items.find((i) => i.id === pizza.id).picked_up_quantity,
        1,
      );
      await action(cocina, "ready", { itemId: pizza.id, ready: false }, 409);
      await action(mesero, "pickup", { itemId: pizza.id, quantity: 3 }, 400);
      const pickupVersion = (await order()).version;
      const pickupResults = await Promise.all(
        [1, 2].map(() =>
          fetch(`${base}/api/orders/${orderId}/actions`, {
            method: "POST",
            headers: {
              Cookie: mesero.cookie,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "pickup",
              version: pickupVersion,
              itemId: pizza.id,
              quantity: 1,
            }),
          }),
        ),
      );
      assert.deepEqual(pickupResults.map((r) => r.status).sort(), [200, 409]);
      await action(caja, "close", {}, 409);
      await action(bar, "ready", { itemId: water.id });
      await action(mesero, "pickup_all", { area: "cocina" });
      assert.equal(
        (await order()).items.find((i) => i.id === pizza.id).picked_up_quantity,
        3,
      );
      assert.equal(
        (await order()).items.find((i) => i.id === water.id).picked_up_quantity,
        0,
      );
      await action(mesero, "pickup_all");
      await action(mesero, "pickup_all", {}, 409);
      await action(caja, "close", {}, 409);
      for (const number of [1, 2]) {
        await action(mesero, "account", {
          account: number,
          name: number === 1 ? "Ana" : "Luis",
          customer: {
            name: number === 1 ? "Ana Prueba" : "Luis Prueba",
            identification: "123",
          },
          tipCents: number === 1 ? 150 : 0,
        });
        await action(mesero, "send_lsoft", { account: number });
        await action(
          mesero,
          "add",
          { productId: food.id, quantity: 1, account: 1, note: "Otra ronda" },
          409,
        );
        const sent = (await order()).accounts.find(
          (a) => a.number === number,
        ).lsoft;
        await action(mesero, "send_lsoft", { account: number });
        assert.deepEqual(
          (await order()).accounts.find((a) => a.number === number).lsoft,
          sent,
        );
        await action(
          mesero,
          "account",
          { account: number, name: "Cambio", customer: {} },
          409,
        );
        await action(caja, "pay", { account: number, method: "efectivo" }, 403);
        await action(
          administrator,
          "pay",
          { account: number, method: "invalid" },
          400,
        );
        if (number === 1) await action(mesero, "close", {}, 409);
      }
      assert.equal((await order()).status, "bill_requested");
      await mesero.request("/api/orders", { tableNumber: 1 }, 409);
      await action(cocina, "close", {}, 403);
      await action(secondWaiter, "close", {}, 403);
      const beforeClose = await order();
      await action(mesero, "close");
      await mesero.request(`/api/orders/${orderId}/actions`, {
        action: "close", version: beforeClose.version,
      }, 409);
      assert.equal(await order(), undefined);
      const history = await caja.request("/api/history");
      assert.equal(history[0].id, orderId);
      assert.equal(history[0].items.length, 2);
      assert.equal(
        history[0].accounts.find((a) => a.number === 1).customer.name,
        "Ana Prueba",
      );
      assert.equal(
        history[0].items.find((i) => i.id === pizza.id).picked_up_quantity,
        3,
      );
      assert.equal(
        history[0].accounts.find((a) => a.number === 1).lsoft.response.estado,
        "pendiente_pago",
      );
      assert.equal(
        history[0].accounts.find((a) => a.number === 1).lsoft.json
          .totalesCentavos.pagar,
        3150,
      );
      assert.equal(
        (await mesero.request("/api/orders", { tableNumber: 1 }, 201))
          .table_number,
        1,
      );
    },
  );
  await t.test(
    "tarifas conservadas, configuración compartida, asignaciones y migración repetible",
    async () => {
      const s = await administrator.request("/api/state");
      const firstWaiter = s.waiters.find((w) => w.name === "Mesero 1"),
        second = s.waiters.find((w) => w.name === "Mesero 2");
      const created = await administrator.request(
        "/api/orders",
        { tableNumber: 2, waiterId: second.id },
        201,
      );
      async function current() {
        return (await administrator.request("/api/state")).orders.find(
          (o) => o.id === created.id,
        );
      }
      async function perform(who, name, fields, expected = 200) {
        return who.request(
          `/api/orders/${created.id}/actions`,
          { version: (await current()).version, action: name, ...fields },
          expected,
        );
      }
      await perform(secondWaiter, "add", {
        productId: food.id,
        quantity: 1,
        account: 1,
        note: "",
      });
      const first = (await current()).items[0],
        oldTariff = first.tariff;
      const config = {
        ...s.settings.config,
        precios: { Pizza: 2000 },
        incluidos: false,
      };
      await administrator.request("/api/config", {
        version: s.settings.version,
        config,
      });
      await administrator.request(
        "/api/config",
        { version: s.settings.version, config },
        409,
      );
      assert.deepEqual((await current()).items[0].tariff, oldTariff);
      await perform(secondWaiter, "add", {
        productId: food.id,
        quantity: 1,
        account: 1,
        note: "Nueva tarifa",
      });
      assert.equal(
        (await current()).items.find((i) => i.note === "Nueva tarifa").tariff
          .precio,
        2000,
      );
      await perform(
        mesero,
        "add",
        { productId: food.id, quantity: 1, account: 1, note: "" },
        403,
      );
      await perform(administrator, "assign", { waiterId: firstWaiter.id });
      await perform(secondWaiter, "send", {}, 403);
      await perform(administrator, "send", {});
      assert.ok((await current()).items.every((i) => !i.additional));
      const confirmation = { confirmedOtherWaiterId: firstWaiter.id };
      await perform(secondWaiter, "send", confirmation, 403);
      for (const item of (await current()).items)
        await perform(administrator, "ready", { itemId: item.id, ready: true });
      const readyItem = (await current()).items[0];
      await perform(secondWaiter, "pickup", { itemId: readyItem.id, quantity: 1 }, 403);
      await perform(secondWaiter, "pickup", {
        itemId: readyItem.id, quantity: 1, confirmedOtherWaiterId: second.id,
      }, 403);
      await perform(secondWaiter, "pickup", {
        itemId: readyItem.id, quantity: 1, ...confirmation,
      });
      await perform(secondWaiter, "pickup_all", {}, 403);
      await perform(secondWaiter, "pickup_all", confirmation);
      assert.ok((await current()).items.every((i) => i.picked_up_quantity === i.quantity));
      await perform(secondWaiter, "bill", {}, 403);
      await perform(secondWaiter, "bill", confirmation);
      assert.equal((await current()).waiter_id, firstWaiter.id);
      await perform(administrator, "add", {
        productId: drink.id,
        quantity: 1,
        account: 2,
        note: "Ronda adicional",
      });
      await perform(administrator, "send", {});
      assert.equal(
        (await current()).items.find((i) => i.note === "Ronda adicional")
          .additional,
        true,
      );
      const users = await administrator.request("/api/users");
      assert.ok(users.every((u) => u.password_hash === undefined));
      const beforeMigration = await current();
      const init = spawnSync(process.execPath, ["server/init.js"], {
        env: { ...process.env, SEED_PASSWORD: password },
        encoding: "utf8",
      });
      assert.equal(init.status, 0, init.stderr);
      assert.deepEqual(await current(), beforeMigration);
      assert.deepEqual(
        (await administrator.request("/api/state")).settings.config,
        config,
      );
      const version = (await administrator.request("/api/state")).settings
        .version;
      await administrator.request("/api/waiters", {
        version,
        names: ["Mesero", "Mesero 1", "Mesero 2", "Mesero nuevo"],
      });
      assert.ok(
        (await administrator.request("/api/state")).waiters.some(
          (w) => w.name === "Mesero nuevo" && w.active,
        ),
      );
      await administrator.request(
        "/api/waiters",
        { version, names: ["Otra lista"] },
        409,
      );
      assert.equal((await current()).waiter_id, firstWaiter.id);
    },
  );
  await t.test("eliminar para llevar solo vacío, con permisos y control de versión", async () => {
    const created = await mesero.request("/api/orders", {}, 201);
    const path = `/api/orders/${created.id}/actions`;
    const current = async () => (await mesero.request("/api/state")).orders.find((o) => o.id === created.id);
    const empty = await current();
    await cocina.request(path, { action: "delete_empty", version: empty.version }, 403);
    await mesero.request(path, { action: "delete_empty", version: empty.version + 1 }, 409);
    await mesero.request(path, { action: "add", version: empty.version, productId: food.id, quantity: 1, account: 1, note: "" });
    const filled = await current();
    await mesero.request(path, { action: "delete_empty", version: filled.version }, 409);
    await mesero.request(path, { action: "remove", version: filled.version, itemId: filled.items[0].id });
    await mesero.request(path, { action: "delete_empty", version: (await current()).version });
    assert.equal(await current(), undefined);
    assert.equal((await pool.query("SELECT 1 FROM orders WHERE id=$1", [created.id])).rowCount, 0);
  });
  await t.test("fichas de platos: permisos, concurrencia y conservación al cambiar precios", async () => {
    const initial = await administrator.request("/api/state"),
      product = initial.products.find((p) => p.category === "platos"),
      info = { ingredients: "Ingredientes de prueba", preparation: "A la plancha", sides: "Ensalada" };
    assert.ok(product.help.ingredients);
    assert.ok(initial.products.filter((p) => ["entradas", "platos", "postres", "adicionales"].includes(p.category)).every((p) => p.help?.ingredients && p.help?.preparation));
    const payload = { productId: product.id, version: initial.settings.version, info };
    await cocina.request("/api/product-help", payload, 403);
    await administrator.request("/api/product-help", { ...payload, info: { ...info, ingredients: "x".repeat(601) } }, 400);
    await administrator.request("/api/product-help", payload);
    await administrator.request("/api/product-help", payload, 409);
    const saved = await administrator.request("/api/state");
    assert.deepEqual(saved.settings.config.productHelp[product.id], info);
    assert.deepEqual((await bar.request("/api/state")).settings.config.productHelp[product.id], info);
    const { productHelp, ...prices } = saved.settings.config;
    await administrator.request("/api/config", { version: saved.settings.version, config: prices });
    assert.deepEqual((await administrator.request("/api/state")).settings.config.productHelp, productHelp);
    await stop();
    await start();
    assert.deepEqual((await administrator.request("/api/state")).settings.config.productHelp[product.id], info);
  });
  await t.test("nuevo consumo conserva la mesa, el mesero y la cuenta archivada", async () => {
    const created = await mesero.request("/api/orders", { tableNumber: 3 }, 201);
    const path = `/api/orders/${created.id}/actions`;
    const current = async () => (await mesero.request("/api/state")).orders.find((o) => o.id === created.id);
    const perform = async (who, name, fields = {}, expected = 200) => who.request(path,
      { action: name, version: (await current()).version, ...fields }, expected);
    await perform(mesero, "new_consumption", {}, 409);
    for (const account of [1, 2]) await perform(mesero, "add", {
      productId: drink.id, quantity: 1, account, note: "",
    });
    await perform(mesero, "send");
    await perform(mesero, "bill");
    await perform(mesero, "new_consumption", {}, 409);
    for (const item of (await current()).items) await perform(bar, "ready", { itemId: item.id });
    for (const account of [1, 2]) {
      await perform(mesero, "account", { account, name: "Cliente", customer: { name: "Cliente prueba", identification: "123" } });
      await perform(mesero, "send_lsoft", { account });
    }
    await perform(mesero, "new_consumption", {}, 409);
    await perform(mesero, "bill_delivered", { account: 1 });
    await perform(mesero, "collected", { account: 1 });
    await perform(mesero, "new_consumption", {}, 409);
    await perform(administrator, "pay", { account: 2, method: "efectivo" });
    await perform(cocina, "new_consumption", {}, 403);
    await perform(secondWaiter, "new_consumption", {}, 403);
    const original = await current();
    const responses = await Promise.all([1, 2].map(() => fetch(base + path, {
      method: "POST", headers: { Cookie: mesero.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "new_consumption", version: original.version }),
    })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const result = await responses.find((r) => r.status === 200).json();
    const active = (await mesero.request("/api/state")).orders.filter((o) => o.table_number === 3);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, result.orderId);
    assert.equal(active[0].waiter_id, original.waiter_id);
    assert.equal(active[0].status, "open");
    assert.deepEqual(active[0].items, []);
    assert.deepEqual(active[0].accounts, []);
    const archived = (await caja.request("/api/history")).find((o) => o.id === created.id);
    const normalizeItems = (items) => items.map((i) => ({
      ...i, sent_at: new Date(i.sent_at).toISOString(), ready_at: new Date(i.ready_at).toISOString(),
    })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(normalizeItems(archived.items), normalizeItems(original.items));
    // PostgreSQL does not guarantee row order without ORDER BY.
    const normalizeAccounts = (accounts) => [...accounts].sort((a, b) => a.number - b.number);
    assert.deepEqual(normalizeAccounts(archived.accounts), normalizeAccounts(original.accounts));
    await mesero.request(`/api/orders/${result.orderId}/actions`, {
      action: "add", version: active[0].version, productId: drink.id, quantity: 1, account: 1, note: "Nueva ronda",
    });
    await mesero.request("/api/orders", { tableNumber: 3 }, 409);
    const takeaway = await mesero.request("/api/orders", {}, 201);
    await mesero.request(`/api/orders/${takeaway.id}/actions`, { action: "new_consumption", version: takeaway.version }, 409);
  });
  await t.test(
    "persistencia al reiniciar HTTP y sesiones independientes al salir",
    async () => {
      await stop();
      await start();
      assert.ok((await caja.request("/api/history")).some((o) => o.id === orderId));
      assert.equal((await cocina.request("/api/me")).role, "estacion");
      await mesero.request("/api/logout", {});
      await mesero.request("/api/me", undefined, 401);
      assert.equal((await cocina.request("/api/me")).role, "estacion");
      assert.equal((await bar.request("/api/me")).role, "estacion");
    },
  );
});


test("primer plato crea y asigna la mesa en una sola transacción", async () => {
  const waiter = client(), second = client();
  const owner = await waiter.login("mesero");
  await second.login("mesero2");
  const state = await waiter.request("/api/state");
  const table = state.tables.find((t) => !state.orders.some((o) => o.table_number === t.number && o.status !== "closed"));
  assert.ok(table);
  const firstItem = { productId: randomUUID(), quantity: 1, account: 1, note: "" };
  await waiter.request("/api/orders", { tableNumber: table.number, firstItem }, 404);
  assert.equal((await waiter.request("/api/state")).orders.some((o) => o.table_number === table.number && o.status !== "closed"), false);
  firstItem.productId = state.products[0].id;
  const created = await second.request("/api/orders", { tableNumber: table.number, firstItem }, 201);
  const order = (await second.request("/api/state")).orders.find((o) => o.id === created.id);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].quantity, 1);
  assert.notEqual(order.waiter_id, owner.waiter_id);
  await waiter.request("/api/orders", { tableNumber: table.number, firstItem }, 409);
});
