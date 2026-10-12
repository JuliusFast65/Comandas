import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { amounts } from "../money.js";

let admin, pool, app, server, base, seededWithOwnPassword;
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
  // Seeded accounts start with a temporary password; the other tests use them directly.
  seededWithOwnPassword = (await pool.query("SELECT count(*)::int AS n FROM users WHERE NOT must_change_password")).rows[0].n;
  await pool.query("UPDATE users SET must_change_password=false");
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
    DROP TABLE order_item_voids;
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
    login(role, secret = password, expected = 200) {
      return this.request("/api/login", { username: role, password: secret }, expected);
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
      tipCents: 250,
    });
    assert.equal((await order(caja)).accounts.find((a) => a.number === 1).tip_cents, 250);
    assert.deepEqual((await caja.request("/api/customers?identification=%20123%20")).customer,
      { name: "Ana Prueba", identification: "123", email: "ana@example.com" });
    assert.equal((await caja.request("/api/customers?identification=not-registered")).customer, null);
    await caja.request("/api/customers?identification=", undefined, 400);
    await mesero.request("/api/customers?identification=123", undefined, 403);
    await cocina.request("/api/customers?identification=123", undefined, 403);
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
      await administrator.request("/api/products/prices", {
        version: s.settings.version + 1,
        prices: { [food.id]: 2000 },
      });
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

test("administrar estaciones, productos y usuarios conserva destinos y permisos", async () => {
  const administrator = client(), waiter = client(), owner = client();
  await administrator.login("admin");
  const operator = await waiter.login("mesero");
  await owner.login("mesero2");
  async function state() { return administrator.request("/api/state"); }
  async function configure(c, path, fields, expected=200) {
    return c.request(path, { version: (await state()).settings.version, ...fields }, expected);
  }
  await configure(waiter, "/api/stations", { name: "Cafetería" }, 403);
  const cafeteria = await configure(administrator, "/api/stations", { name: "Cafetería" }, 201);
  const desserts = await configure(administrator, "/api/stations", { name: "Postres" }, 201);
  await configure(administrator, "/api/stations", { name: "  CAFETERÍA  " }, 409);
  await configure(administrator, "/api/stations", { name: " " }, 400);
  assert.equal((await waiter.request("/api/state")).users, undefined);
  assert.ok((await state()).users.every((u) => !Object.hasOwn(u, "password_hash")));
  const userPath = `/api/users/${operator.id}/stations`;
  await configure(waiter, userPath, { stations: [cafeteria.code] }, 403);
  await configure(administrator, userPath, { stations: [cafeteria.code, desserts.code] });
  assert.deepEqual((await waiter.request("/api/me")).stations.sort(), [cafeteria.code, desserts.code].sort());
  assert.equal((await waiter.request("/api/me")).role, "mesero");
  await configure(administrator, userPath, { stations: ["inexistente"] }, 400);
  await configure(administrator, userPath, { stations: [cafeteria.code,cafeteria.code] }, 400);
  const coffee = (await state()).products.find((p) => p.name === "Café");
  const created = await owner.request("/api/orders", {}, 201);
  async function current() {
    return (await owner.request("/api/state")).orders.find((o) => o.id === created.id);
  }
  async function perform(c, action, fields={}, expected=200) {
    return c.request(`/api/orders/${created.id}/actions`, { action, version: (await current()).version, ...fields }, expected);
  }
  const addCoffee = { productId: coffee.id, quantity: 1, account: 1, note: "" };
  await perform(owner, "add", addCoffee);
  const original = (await current()).items[0];
  const productPath = "/api/products/station";
  await configure(waiter, productPath, { productIds: [coffee.id], stationCode: cafeteria.code }, 403);
  await configure(administrator, productPath, { productIds: [coffee.id,randomUUID()], stationCode: cafeteria.code }, 404);
  assert.equal((await state()).products.find((p) => p.id === coffee.id).area, "bar");
  await configure(administrator, productPath, { productIds: [coffee.id], stationCode: cafeteria.code });
  await perform(owner, "add", addCoffee);
  const items = (await current()).items;
  assert.equal(items.length, 2);
  assert.deepEqual(items.find((i) => i.id === original.id), original);
  const newItem = items.find((i) => i.area === cafeteria.code);
  assert.ok(newItem);
  await perform(owner, "send");
  await perform(owner, "ready", { itemId: newItem.id }, 403);
  await perform(waiter, "ready", { itemId: original.id }, 403);
  await perform(waiter, "ready", { itemId: newItem.id });
  await configure(administrator, userPath, { stations: [desserts.code] });
  await perform(waiter, "ready", { itemId: newItem.id, ready: false }, 403);
  await configure(administrator, userPath, { stations: [cafeteria.code, desserts.code] });
  const stationPath = `/api/stations/${cafeteria.code}`;
  await configure(waiter, stationPath, { name: "Cafetería", active: true }, 403);
  await configure(administrator, stationPath, { name: "Postres", active: true }, 409);
  await configure(administrator, stationPath, { name: "Café y bebidas calientes", active: true });
  assert.equal((await current()).items.find((i) => i.id === newItem.id).area, cafeteria.code);
  await configure(administrator, stationPath, { name: "Café y bebidas calientes", active: false }, 409);
  await configure(administrator, productPath, { productIds: [coffee.id], stationCode: "bar" });
  await configure(administrator, stationPath, { name: "Café y bebidas calientes", active: false }, 409);
  await perform(owner, "pickup_all", { area: cafeteria.code });
  assert.equal((await current()).items.find((i) => i.id === original.id).picked_up_quantity, 0);
  await perform(owner, "pickup_all", { area: "inexistente" }, 400);
  await configure(administrator, stationPath, { name: "Café y bebidas calientes", active: false });
  assert.deepEqual((await waiter.request("/api/me")).stations, [desserts.code]);
  assert.ok((await administrator.request("/api/users")).find((u) => u.id===operator.id).stations.includes(cafeteria.code));
  await configure(administrator, productPath, { productIds: [coffee.id], stationCode: cafeteria.code }, 400);
  const configuration = await state();
  const version = configuration.settings.version;
  const concurrent = await Promise.all([1,2].map(() => fetch(base + `/api/stations/${desserts.code}`, {
    method: "POST", headers: { Cookie: administrator.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Postres", active: true, version }),
  })));
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200,409]);
  const init = spawnSync(process.execPath, ["server/init.js"], {
    env: { ...process.env, SEED_PASSWORD: password }, encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);
  assert.equal((await state()).stations.find((s) => s.code===cafeteria.code).active, false);
  assert.equal((await state()).stations.find((s) => s.code===cafeteria.code).name, "Café y bebidas calientes");
  await configure(administrator, stationPath, { name: "Café y bebidas calientes", active: true });
  assert.ok((await waiter.request("/api/me")).stations.includes(cafeteria.code));
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

test("supervisor coordina todas las mesas sin permisos de configuración ni caja", async () => {
  const supervisor=client(), administrator=client(), waiter=client(), second=client();
  const seeded=await supervisor.login("supervisor");
  assert.equal(seeded.role,"supervisor");
  assert.deepEqual(seeded.stations,[]);
  const adminUser=await administrator.login("admin");
  const waiterUser=await waiter.login("mesero");
  const secondUser=await second.login("mesero2");
  const state=await administrator.request("/api/state");
  const food=state.products.find(p=>p.area==='cocina');
  assert.equal((await supervisor.request("/api/state")).users,undefined);
  await supervisor.request("/api/users",undefined,403);
  await supervisor.request("/api/customers?identification=123",undefined,403);
  for(const path of ["/api/config","/api/stations","/api/products/station","/api/waiters",`/api/users/${waiterUser.id}/stations`,`/api/users/${waiterUser.id}/waiter`,`/api/users/${waiterUser.id}/role`])
    await supervisor.request(path,{},403);
  const created=await second.request("/api/orders",{},201);
  async function current(){ return (await supervisor.request("/api/state")).orders.find(o=>o.id===created.id); }
  async function perform(c,action,fields={},expected=200){
    return c.request(`/api/orders/${created.id}/actions`,{action,version:(await current()).version,...fields},expected);
  }
  await perform(supervisor,"add",{productId:food.id,quantity:1,account:1,note:""});
  const item=(await current()).items[0];
  await perform(waiter,"edit",{itemId:item.id,quantity:2,account:1,note:""},403);
  await perform(supervisor,"edit",{itemId:item.id,quantity:2,account:1,note:"Sin sal"});
  await perform(supervisor,"assign",{waiterId:waiterUser.waiter_id});
  assert.equal((await current()).waiter_id,waiterUser.waiter_id);
  await perform(supervisor,"account",{account:1,name:"Familia",customer:{name:"Cliente",identification:"456"}});
  assert.equal((await current()).accounts[0].customer.name,"Cliente");
  await perform(supervisor,"send");
  await perform(supervisor,"ready",{itemId:item.id},403);
  for (const stations of [["cocina"],[]]) {
    await administrator.request(`/api/users/${seeded.id}/stations`, {
      stations,version:(await administrator.request("/api/state")).settings.version,
    });
    if (stations.length) {
      await perform(supervisor,"ready",{itemId:item.id});
      await perform(supervisor,"ready",{itemId:item.id,ready:false});
    }
  }
  await perform(administrator,"ready",{itemId:item.id});
  await perform(supervisor,"pickup_all",{area:"cocina"});
  await perform(supervisor,"bill");
  await perform(supervisor,"bill_delivered",{account:1});
  await perform(supervisor,"collected",{account:1});
  await perform(supervisor,"documents_received",{account:1},403);
  await perform(supervisor,"pay",{account:1},403);
  await perform(supervisor,"send_lsoft",{account:1});
  await perform(supervisor,"assign",{waiterId:secondUser.waiter_id},409);
  await perform(supervisor,"close");
  assert.ok((await supervisor.request("/api/history")).some(o=>o.id===created.id));
  await supervisor.request("/api/orders",{},400);
  const newOrder=await supervisor.request("/api/orders",{waiterId:secondUser.waiter_id},201);
  assert.equal(newOrder.waiter_id,secondUser.waiter_id);
  const empty=(await supervisor.request("/api/state")).orders.find(o=>o.id===newOrder.id);
  await supervisor.request(`/api/orders/${newOrder.id}/actions`,{action:"delete_empty",version:empty.version});
  async function role(fields,expected=200){
    return administrator.request(`/api/users/${waiterUser.id}/role`,{
      version:(await administrator.request("/api/state")).settings.version,...fields,
    },expected);
  }
  await role({role:"admin"},400);
  const version=(await administrator.request("/api/state")).settings.version;
  await administrator.request(`/api/users/${adminUser.id}/role`,{role:"supervisor",version},400);
  await role({role:"supervisor"});
  assert.equal((await waiter.request("/api/me")).role,"supervisor");
  assert.equal((await waiter.request("/api/me")).waiter_id,waiterUser.waiter_id);
  assert.deepEqual((await waiter.request("/api/me")).stations,waiterUser.stations);
  await waiter.request("/api/history");
  await administrator.request(`/api/users/${waiterUser.id}/role`,{role:"mesero",version},409);
  const init=spawnSync(process.execPath,["server/init.js"],{env:{...process.env,SEED_PASSWORD:password},encoding:"utf8"});
  assert.equal(init.status,0,init.stderr);
  assert.equal((await waiter.request("/api/me")).role,"supervisor");
  await role({role:"mesero"});
  assert.equal((await waiter.request("/api/me")).role,"mesero");
  await waiter.request("/api/history",undefined,403);
});

test("ocupación explícita, liberación y eliminación del último plato", async () => {
  const waiter = client(), other = client(), administrator = client();
  const owner = await waiter.login("mesero");
  await other.login("mesero2");
  await administrator.login("admin");
  const state = await waiter.request("/api/state");
  const table = state.tables.find((t) => !state.orders.some((o) => o.table_number === t.number));
  assert.ok(table);
  const firstItem = { productId: state.products[0].id, quantity: 1, account: 1, note: "" };
  async function current(id) {
    return (await waiter.request("/api/state")).orders.find((o) => o.id === id);
  }
  async function perform(c, id, action, fields = {}, expected = 200) {
    return c.request(`/api/orders/${id}/actions`, {
      action, version: (await current(id)).version, ...fields,
    }, expected);
  }
  const occupied = await waiter.request("/api/orders", {
    tableNumber: table.number, occupiedExplicitly: true,
  }, 201);
  assert.equal(occupied.waiter_id, owner.waiter_id);
  assert.equal((await current(occupied.id)).occupied_explicitly, true);
  await perform(other, occupied.id, "release", {}, 403);
  await perform(waiter, occupied.id, "add", firstItem);
  await perform(waiter, occupied.id, "release", {}, 409);
  await perform(waiter, occupied.id, "remove", { itemId: (await current(occupied.id)).items[0].id });
  assert.equal((await current(occupied.id)).items.length, 0);
  assert.equal((await current(occupied.id)).occupied_explicitly, true);
  const version = (await current(occupied.id)).version;
  await waiter.request(`/api/orders/${occupied.id}/actions`, { action: "release", version: version - 1 }, 409);
  await perform(waiter, occupied.id, "release");
  assert.equal(await current(occupied.id), undefined);
  const implicit = await waiter.request("/api/orders", { tableNumber: table.number, firstItem }, 201);
  await perform(waiter, implicit.id, "add", { ...firstItem, note: "Otro plato" });
  await perform(waiter, implicit.id, "remove", { itemId: (await current(implicit.id)).items[0].id });
  assert.equal((await current(implicit.id)).items.length, 1);
  await perform(waiter, implicit.id, "remove", { itemId: (await current(implicit.id)).items[0].id });
  assert.equal(await current(implicit.id), undefined);
  const confirmed = await waiter.request("/api/orders", { tableNumber: table.number, firstItem }, 201);
  await perform(waiter, confirmed.id, "occupy", {}, 409);
  assert.equal((await current(confirmed.id)).occupied_explicitly, false);
  await perform(waiter, confirmed.id, "remove", { itemId: (await current(confirmed.id)).items[0].id });
  assert.equal(await current(confirmed.id), undefined);
  const sent = await waiter.request("/api/orders", { tableNumber: table.number, firstItem }, 201);
  await perform(waiter, sent.id, "send");
  await perform(waiter, sent.id, "occupy", {}, 409);
  await perform(waiter, sent.id, "remove", { itemId: (await current(sent.id)).items[0].id }, 409);
  await perform(waiter, sent.id, "release", {}, 409);
  await waiter.request("/api/orders", { occupiedExplicitly: true }, 400);
  await waiter.request("/api/orders", { tableNumber: table.number, occupiedExplicitly: "yes" }, 400);
  const archived = (await administrator.request("/api/history")).find((o) => o.id === implicit.id);
  assert.equal(archived.status, "closed");
  assert.equal(archived.waiter_id, owner.waiter_id);
  assert.ok((await pool.query("SELECT 1 FROM order_events WHERE order_id=$1 AND action='release'", [implicit.id])).rowCount);
  const init = spawnSync(process.execPath, ["server/init.js"], {
    env: { ...process.env, SEED_PASSWORD: password }, encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);
  assert.equal((await current(sent.id)).items.length, 1);
});

test("contraseñas propias, cuentas nuevas, restablecimiento y desactivación", async () => {
  assert.equal(seededWithOwnPassword, 0);
  const administrator = client(), waiter = client(), person = client(), otherDevice = client();
  const adminUser = await administrator.login("admin");
  await waiter.login("mesero");
  const waiterId = (await administrator.request("/api/state")).waiters.find((w) => w.active).id;
  const fields = { username: "nueva.persona", role: "mesero", password: "temporal-123", waiterId };
  await waiter.request("/api/users", fields, 403);
  await administrator.request("/api/users", { ...fields, username: "Con Espacios" }, 400);
  await administrator.request("/api/users", { ...fields, password: "corta" }, 400);
  await administrator.request("/api/users", { ...fields, waiterId: null }, 400);
  await administrator.request("/api/users", { ...fields, role: "caja" }, 400);
  await administrator.request("/api/users", { ...fields, username: "admin" }, 409);
  const created = await administrator.request("/api/users", fields, 201);
  assert.equal(Object.hasOwn(created, "password_hash"), false);

  // A temporary password only allows replacing it.
  const signed = await person.login("nueva.persona", "temporal-123");
  assert.equal(signed.must_change_password, true);
  const blocked = await person.request("/api/state", undefined, 403);
  assert.equal(blocked.code, "password_change_required");
  await person.request("/api/orders", {}, 403);
  assert.equal((await person.request("/api/me")).must_change_password, true);
  await otherDevice.login("nueva.persona", "temporal-123");
  await person.request("/api/password", { current: "incorrecta-000", password: "propia-456789" }, 400);
  await person.request("/api/password", { current: "temporal-123", password: "corta" }, 400);
  await person.request("/api/password", { current: "temporal-123", password: "temporal-123" }, 400);
  await person.request("/api/password", { current: "temporal-123", password: "propia-456789" });
  assert.equal((await person.request("/api/me")).must_change_password, false);
  assert.ok((await person.request("/api/state")).tables.length);
  // The change closes the other devices and the previous password stops working.
  await otherDevice.request("/api/me", undefined, 401);
  await otherDevice.login("nueva.persona", "temporal-123", 401);

  await waiter.request(`/api/users/${created.id}/password`, { password: "temporal-999" }, 403);
  await administrator.request(`/api/users/${adminUser.id}/password`, { password: "temporal-999" }, 400);
  await administrator.request(`/api/users/${created.id}/password`, { password: "temporal-999" });
  await person.request("/api/me", undefined, 401);
  await person.login("nueva.persona", "propia-456789", 401);
  assert.equal((await person.login("nueva.persona", "temporal-999")).must_change_password, true);
  assert.equal((await administrator.request("/api/state")).users.find((u) => u.id === created.id).must_change_password, true);

  await administrator.request(`/api/users/${adminUser.id}/active`, { active: false }, 400);
  await waiter.request(`/api/users/${created.id}/active`, { active: false }, 403);
  await administrator.request(`/api/users/${created.id}/active`, { active: false });
  await person.request("/api/me", undefined, 401);
  await person.login("nueva.persona", "temporal-999", 401);
  await administrator.request(`/api/users/${created.id}/active`, { active: true });
  await person.login("nueva.persona", "temporal-999");
  // A request without a JSON body is rejected as invalid, not as a server error.
  const empty = await fetch(base + "/api/login", { method: "POST" });
  assert.equal(empty.status, 400);
});

test("el servidor continúa cuando PostgreSQL cierra sus conexiones inactivas", async () => {
  const waiter = client();
  await waiter.login("mesero");
  await waiter.request("/api/state");
  assert.ok(pool.listenerCount("error") > 0);
  const terminated = await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
    [database],
  );
  assert.ok(terminated.rowCount > 0);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok((await waiter.request("/api/state")).tables.length);
});

test("anulaciones, correcciones tras el envío y bitácora detallada", async () => {
  const waiter = client(), other = client(), supervisor = client(), kitchen = client(), bar = client(),
    cashier = client(), auditor = client(), administrator = client();
  await waiter.login("mesero");
  await other.login("mesero2");
  await supervisor.login("supervisor");
  await kitchen.login("cocina");
  await bar.login("bar");
  await cashier.login("caja");
  await auditor.login("auditor");
  await administrator.login("admin");
  const initial = await waiter.request("/api/state");
  const food = initial.products.find((p) => p.area === "cocina");
  const drink = initial.products.find((p) => p.area === "bar");
  const free = initial.tables.map((t) => t.number).filter((n) => !initial.orders.some((o) => o.table_number === n));
  assert.ok(free.length >= 3);
  const created = await waiter.request("/api/orders", {
    tableNumber: free[0], firstItem: { productId: food.id, quantity: 4, account: 1, note: "" },
  }, 201);
  const path = `/api/orders/${created.id}/actions`;
  const current = async (c = waiter) => (await c.request("/api/state")).orders.find((o) => o.id === created.id);
  const perform = async (c, action, fields = {}, expected = 200) =>
    c.request(path, { action, version: (await current()).version, ...fields }, expected);
  const item = async (productId, account = 1) =>
    (await current()).items.find((i) => i.product_id === productId && i.account === account);
  await perform(waiter, "add", { productId: drink.id, quantity: 2, account: 1, note: "" });

  // A draft is removed, not voided.
  await perform(waiter, "void", { itemId: (await item(food.id)).id, quantity: 1, reason: "Error" }, 409);
  await perform(waiter, "send");
  const foodItem = await item(food.id), drinkItem = await item(drink.id);

  // Voiding requires the owner, a valid quantity and a reason.
  await perform(other, "void", { itemId: foodItem.id, quantity: 1, reason: "Error" }, 403);
  await perform(kitchen, "void", { itemId: foodItem.id, quantity: 1, reason: "Error" }, 403);
  await perform(cashier, "void", { itemId: foodItem.id, quantity: 1, reason: "Error" }, 403);
  await perform(waiter, "void", { itemId: foodItem.id, quantity: 1, reason: "  " }, 400);
  await perform(waiter, "void", { itemId: foodItem.id, quantity: 5, reason: "Error" }, 400);
  await perform(waiter, "void", { itemId: foodItem.id, quantity: 1, reason: " El cliente cambió de opinión " });
  let order = await current();
  assert.equal(order.items.find((i) => i.id === foodItem.id).quantity, 3);
  assert.equal(order.voids.length, 1);
  assert.deepEqual(
    (({ quantity, reason, username, item_status, product_name }) => ({ quantity, reason, username, item_status, product_name }))(order.voids[0]),
    { quantity: 1, reason: "El cliente cambió de opinión", username: "mesero", item_status: "preparing", product_name: food.name },
  );

  // The station sees the notice and confirms it; another station cannot.
  const notice = (await current(kitchen)).voids[0];
  await perform(bar, "void_seen", { voidId: Number(notice.id) }, 403);
  await perform(waiter, "void_seen", { voidId: Number(notice.id) }, 403);
  await perform(kitchen, "void_seen", { voidId: Number(notice.id) });
  await perform(kitchen, "void_seen", { voidId: Number(notice.id) }, 409);
  assert.ok((await current()).voids[0].acknowledged_at);

  // Note of a product in preparation.
  await perform(other, "note", { itemId: foodItem.id, note: "Sin sal" }, 403);
  await perform(waiter, "note", { itemId: foodItem.id, note: "Sin sal" });
  await perform(waiter, "note", { itemId: foodItem.id, note: "Sin sal" }, 409);
  order = await current();
  assert.equal(order.items.find((i) => i.id === foodItem.id).note, "Sin sal");
  assert.ok(order.items.find((i) => i.id === foodItem.id).note_changed_at);

  // Once prepared: the waiter needs a supervisor, and the note is fixed.
  await perform(kitchen, "ready", { itemId: foodItem.id });
  await perform(waiter, "void", { itemId: foodItem.id, quantity: 1, reason: "Error" }, 403);
  await perform(waiter, "note", { itemId: foodItem.id, note: "Otra" }, 409);
  await perform(waiter, "pickup", { itemId: foodItem.id, quantity: 2 });
  // Of 3 units (2 served), voiding 2 keeps one served unit and records one served unit as voided.
  await perform(supervisor, "void", { itemId: foodItem.id, quantity: 2, reason: "Producto devuelto" });
  order = await current();
  assert.deepEqual(
    (({ quantity, picked_up_quantity, status }) => ({ quantity, picked_up_quantity, status }))(order.items.find((i) => i.id === foodItem.id)),
    { quantity: 1, picked_up_quantity: 1, status: "ready" },
  );
  assert.equal(order.voids[1].picked_up_quantity, 1);
  assert.equal(order.voids[1].username, "supervisor");

  // Moving part of a product to another account splits it and keeps the totals.
  const totalBefore = order.items.reduce((n, i) => n + i.quantity * i.tariff.precio, 0);
  await perform(waiter, "move", { itemId: drinkItem.id, quantity: 1, toAccount: 1 }, 400);
  await perform(waiter, "move", { itemId: drinkItem.id, quantity: 3, toAccount: 2 }, 400);
  await perform(other, "move", { itemId: drinkItem.id, quantity: 1, toAccount: 2 }, 403);
  await perform(waiter, "move", { itemId: drinkItem.id, quantity: 1, toAccount: 2 });
  order = await current();
  assert.deepEqual(order.items.filter((i) => i.product_id === drink.id).map((i) => [i.account, i.quantity, i.status]).sort(),
    [[1, 1, "preparing"], [2, 1, "preparing"]]);
  assert.ok(order.accounts.some((a) => a.number === 2));
  assert.equal(order.items.reduce((n, i) => n + i.quantity * i.tariff.precio, 0), totalBefore);
  await perform(waiter, "move", { itemId: (await item(drink.id, 2)).id, quantity: 1, toAccount: 3 });
  assert.equal((await item(drink.id, 3)).quantity, 1);
  assert.equal(await item(drink.id, 2), undefined);

  // Changing tables: only to a free, existing table.
  const busy = await other.request("/api/orders", { tableNumber: free[1], occupiedExplicitly: true }, 201);
  await perform(waiter, "transfer", { tableNumber: free[1] }, 409);
  await perform(waiter, "transfer", { tableNumber: 998 }, 400);
  await perform(other, "transfer", { tableNumber: free[2] }, 403);
  await perform(waiter, "transfer", { tableNumber: free[2] });
  assert.equal((await current()).table_number, free[2]);
  await other.request(`/api/orders/${busy.id}/actions`, { action: "release", version: 1 });

  // An invoiced account is closed to corrections; the other accounts are not.
  for (const i of (await current()).items.filter((i) => i.status === "preparing"))
    await perform(bar, "ready", { itemId: i.id });
  await perform(waiter, "bill");
  await perform(cashier, "account", { account: 1, name: "", customer: { identification: "0912345678", name: "Cliente Uno" } });
  await perform(cashier, "send_lsoft", { account: 1 });
  await perform(supervisor, "void", { itemId: foodItem.id, quantity: 1, reason: "Tarde" }, 409);
  await perform(supervisor, "move", { itemId: (await item(drink.id, 3)).id, quantity: 1, toAccount: 1 }, 409);
  await perform(supervisor, "transfer", { tableNumber: free[0] }, 409);
  await perform(supervisor, "void", { itemId: (await item(drink.id, 3)).id, quantity: 1, reason: "No lo pidió" });
  assert.equal(await item(drink.id, 3), undefined);

  // The log records who did what, with quantities, reasons and amounts.
  await waiter.request(`/api/orders/${created.id}/events`, undefined, 403);
  await kitchen.request(`/api/orders/${created.id}/events`, undefined, 403);
  const events = await auditor.request(`/api/orders/${created.id}/events`);
  const of = (action) => events.filter((e) => e.action === action);
  assert.deepEqual(events[0].details, { product: food.name, quantity: 4, account: 1, note: "" });
  assert.deepEqual(of("send")[0].details.items.map((i) => i.quantity).sort(), [2, 4]);
  assert.deepEqual(of("void").map((e) => [e.username, e.details.quantity, e.details.reason, e.details.picked_up]), [
    ["mesero", 1, "El cliente cambió de opinión", 0],
    ["supervisor", 2, "Producto devuelto", 1],
    ["supervisor", 1, "No lo pidió", 0],
  ]);
  assert.equal(of("void")[0].details.cents, amounts(foodItem.tariff, 1).total);
  assert.deepEqual(of("note")[0].details, { product: food.name, account: 1, from: "", to: "Sin sal" });
  assert.deepEqual(of("move")[0].details, { product: drink.name, quantity: 1, from: 1, to: 2 });
  assert.deepEqual(of("transfer")[0].details, { from: free[0], to: free[2] });
  assert.equal(of("pickup")[0].details.quantity, 2);
  assert.equal(of("ready")[0].username, "cocina");
  assert.equal(of("send_lsoft")[0].details.retry, false);

  // General audit: restricted, filtered, and it includes the administrative log.
  await waiter.request("/api/audit", undefined, 403);
  await cashier.request("/api/audit", undefined, 403);
  const corrections = await auditor.request("/api/audit?scope=correcciones");
  assert.ok(corrections.length >= 6);
  assert.ok(corrections.every((e) => e.scope === "pedido" && ["void", "note", "move", "transfer", "remove", "edit", "assign"].includes(e.action)));
  assert.equal(corrections.find((e) => e.action === "void").table_number, free[2]);
  await pool.query("UPDATE users SET must_change_password=false WHERE username='nueva.persona'");
  const administration = await administrator.request("/api/audit?scope=administracion");
  for (const action of ["login", "user_created", "password_reset", "user_deactivated", "user_activated", "password_changed", "station_created", "config_changed"])
    assert.ok(administration.some((e) => e.action === action), action);
  assert.ok(administration.every((e) => e.scope === "administracion"));
  assert.ok(!JSON.stringify(administration).includes("temporal-"));

  // Closing keeps voids and events in the history.
  await perform(cashier, "close");
  const archived = (await auditor.request("/api/history")).find((o) => o.id === created.id);
  assert.equal(archived.voids.length, 3);
  assert.equal(archived.events.at(-1).action, "close");
  assert.equal(archived.events.length, events.length + 1);
});

test("un pedido con todo anulado se libera y conserva su rastro", async () => {
  const waiter = client(), administrator = client();
  await waiter.login("mesero");
  await administrator.login("admin");
  const state = await waiter.request("/api/state");
  const product = state.products[0];
  const table = state.tables.map((t) => t.number).find((n) => !state.orders.some((o) => o.table_number === n));
  const run = async (id, action, fields = {}, expected = 200) => {
    const order = (await waiter.request("/api/state")).orders.find((o) => o.id === id);
    return waiter.request(`/api/orders/${id}/actions`, { action, version: order.version, ...fields }, expected);
  };
  const firstItem = { productId: product.id, quantity: 1, account: 1, note: "" };
  const seated = await waiter.request("/api/orders", { tableNumber: table, firstItem }, 201);
  await run(seated.id, "send");
  await run(seated.id, "bill");
  await run(seated.id, "release", {}, 409);
  const item = (await waiter.request("/api/state")).orders.find((o) => o.id === seated.id).items[0];
  await run(seated.id, "void", { itemId: item.id, quantity: 1, reason: "Se retiraron" });
  await run(seated.id, "close", {}, 409);
  await run(seated.id, "release");
  const history = await administrator.request("/api/history");
  assert.equal(history.find((o) => o.id === seated.id).voids[0].reason, "Se retiraron");

  // Takeaway: with voids it is archived; without history worth keeping it is deleted and logged.
  const takeaway = await waiter.request("/api/orders", { firstItem }, 201);
  await run(takeaway.id, "send");
  const sent = (await waiter.request("/api/state")).orders.find((o) => o.id === takeaway.id).items[0];
  await run(takeaway.id, "void", { itemId: sent.id, quantity: 1, reason: "Error al tomar el pedido" });
  await run(takeaway.id, "delete_empty");
  assert.equal((await pool.query("SELECT status FROM orders WHERE id=$1", [takeaway.id])).rows[0].status, "closed");
  const empty = await waiter.request("/api/orders", { firstItem }, 201);
  const draft = (await waiter.request("/api/state")).orders.find((o) => o.id === empty.id).items[0];
  await run(empty.id, "remove", { itemId: draft.id });
  await run(empty.id, "delete_empty");
  assert.equal((await pool.query("SELECT 1 FROM orders WHERE id=$1", [empty.id])).rowCount, 0);
  const deleted = (await administrator.request("/api/audit?scope=administracion")).find((e) => e.action === "order_deleted");
  assert.equal(deleted.details.number, Number(empty.number));
  assert.deepEqual(deleted.details.events.map((e) => e.action), ["created", "remove"]);
  assert.equal(deleted.details.events[1].details.product, product.name);
});

test("catálogo: categorías, productos, precios y mesas administrados desde la aplicación", async () => {
  const administrator = client(), waiter = client(), auditor = client();
  await administrator.login("admin");
  await waiter.login("mesero");
  await auditor.login("auditor");
  const state = () => administrator.request("/api/state");
  const configure = async (c, path, fields, expected = 200) =>
    c.request(path, { version: (await state()).settings.version, ...fields }, expected);
  const initial = await state();
  assert.deepEqual(initial.categories.slice(0, 2).map((c) => [c.code, c.name, c.active]),
    [["entradas", "Entradas", true], ["platos", "Platos fuertes", true]]);
  assert.ok(initial.products.every((p) => Number.isInteger(p.price_cents) && p.active === true));
  assert.equal(initial.settings.config.precios, undefined);

  // Categories.
  await configure(waiter, "/api/categories", { name: "Menú del día" }, 403);
  await configure(administrator, "/api/categories", { name: "  " }, 400);
  await configure(administrator, "/api/categories", { name: "ENTRADAS" }, 409);
  const category = await configure(administrator, "/api/categories", { name: "Menú del día" }, 201);
  assert.ok(category.position > 6);
  await configure(administrator, `/api/categories/${category.code}`, { name: "Platos fuertes", position: 0, active: true }, 409);
  await configure(administrator, "/api/categories/inexistente", { name: "Otra", position: 0, active: true }, 404);
  await configure(administrator, `/api/categories/${category.code}`, { name: "Almuerzos", position: 0, active: true });
  assert.equal((await state()).categories[0].name, "Almuerzos");

  // Products.
  const fields = { name: "Sopa del día", category: category.code, stationCode: "cocina", priceCents: 450 };
  await configure(waiter, "/api/products", fields, 403);
  await configure(administrator, "/api/products", { ...fields, name: " " }, 400);
  await configure(administrator, "/api/products", { ...fields, priceCents: -1 }, 400);
  await configure(administrator, "/api/products", { ...fields, priceCents: 4.5 }, 400);
  await configure(administrator, "/api/products", { ...fields, category: "inexistente" }, 400);
  await configure(administrator, "/api/products", { ...fields, stationCode: "inexistente" }, 400);
  const product = await configure(administrator, "/api/products", fields, 201);
  await configure(administrator, "/api/products", { ...fields, name: "SOPA DEL DÍA" }, 409);
  await administrator.request("/api/products", { ...fields, name: "Otra sopa", version: 0 }, 409);

  const free = initial.tables.map((t) => t.number).filter((n) => !initial.orders.some((o) => o.table_number === n));
  const order = await waiter.request("/api/orders", {
    tableNumber: free[0], firstItem: { productId: product.id, quantity: 1, account: 1, note: "" },
  }, 201);
  const current = async () => (await waiter.request("/api/state")).orders.find((o) => o.id === order.id);
  const add = async (expected = 200) => waiter.request(`/api/orders/${order.id}/actions`, {
    action: "add", version: (await current()).version, productId: product.id, quantity: 1, account: 1, note: "",
  }, expected);
  assert.equal((await current()).items[0].tariff.precio, 450);

  // Renaming and repricing only affects what is ordered afterwards.
  const changed = { ...fields, name: "Sopa de la casa", priceCents: 500, active: true };
  await configure(waiter, `/api/products/${product.id}`, changed, 403);
  await configure(administrator, `/api/products/${randomUUID()}`, changed, 404);
  await configure(administrator, `/api/products/${product.id}`, changed);
  await add();
  assert.deepEqual((await current()).items.map((i) => [i.product_name, i.tariff.precio]).sort(),
    [["Sopa de la casa", 500], ["Sopa del día", 450]]);

  // Unavailable products and hidden categories cannot be ordered; nothing is deleted.
  await configure(administrator, `/api/products/${product.id}`, { ...changed, active: false });
  await add(409);
  assert.equal((await state()).products.find((p) => p.id === product.id).active, false);
  await configure(administrator, `/api/products/${product.id}`, changed);
  await configure(administrator, `/api/categories/${category.code}`, { name: "Almuerzos", position: 0, active: false });
  await add(409);
  await configure(administrator, `/api/categories/${category.code}`, { name: "Almuerzos", position: 0, active: true });

  // Prices saved together.
  const other = initial.products.find((p) => p.category === "postres");
  await configure(waiter, "/api/products/prices", { prices: { [product.id]: 700 } }, 403);
  await configure(administrator, "/api/products/prices", { prices: {} }, 400);
  await configure(administrator, "/api/products/prices", { prices: { [randomUUID()]: 700 } }, 404);
  await administrator.request("/api/products/prices", { version: 0, prices: { [product.id]: 700 } }, 409);
  const saved = await configure(administrator, "/api/products/prices", {
    prices: { [product.id]: 700, [other.id]: other.price_cents },
  });
  assert.equal(saved.changed, 1);
  await add();
  assert.ok((await current()).items.some((i) => i.tariff.precio === 700));

  // Tables.
  await configure(waiter, "/api/tables", { number: 50, zone: "Terraza" }, 403);
  await configure(administrator, "/api/tables", { number: 0, zone: "" }, 400);
  await configure(administrator, "/api/tables", { number: free[0], zone: "" }, 409);
  await configure(administrator, "/api/tables", { number: 50, zone: " Terraza " }, 201);
  assert.deepEqual((await state()).tables.find((t) => t.number === 50), { number: 50, zone: "Terraza", active: true });
  await waiter.request("/api/orders", { tableNumber: 51 }, 400);
  await waiter.request(`/api/orders/${order.id}/actions`, { action: "transfer", version: (await current()).version, tableNumber: 50 });
  await configure(administrator, "/api/tables/50", { zone: "Terraza", active: false }, 409);
  await configure(administrator, "/api/tables/51", { zone: "", active: true }, 404);
  await configure(administrator, `/api/tables/${free[0]}`, { zone: "Salón", active: false });
  await waiter.request("/api/orders", { tableNumber: free[0], occupiedExplicitly: true }, 409);
  await waiter.request(`/api/orders/${order.id}/actions`, { action: "transfer", version: (await current()).version, tableNumber: free[0] }, 400);
  await configure(administrator, `/api/tables/${free[0]}`, { zone: "Salón", active: true });

  // Reinitializing never restores the seed catalog over the administered one.
  const first = initial.products.find((p) => p.category === "entradas");
  await configure(administrator, `/api/products/${first.id}`, {
    name: first.name + " especial", category: first.category, stationCode: first.area, priceCents: first.price_cents, active: true,
  });
  const before = (await pool.query("SELECT count(*)::int AS n FROM products")).rows[0].n;
  const init = spawnSync(process.execPath, ["server/init.js"], {
    env: { ...process.env, SEED_PASSWORD: password }, encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM products")).rows[0].n, before);

  const audit = await auditor.request("/api/audit?scope=administracion");
  for (const action of ["category_created", "category_changed", "product_created", "product_changed", "prices_changed", "table_created", "table_changed"])
    assert.ok(audit.some((e) => e.action === action), action);
  assert.deepEqual(audit.find((e) => e.action === "prices_changed").details.changes,
    [{ product: "Sopa de la casa", from: 500, to: 700 }]);
  const rename = audit.find((e) => e.action === "product_changed" && e.details.name?.to === "Sopa de la casa");
  assert.deepEqual(rename.details.price_cents, { from: 450, to: 500 });
});

test("la migración 10 traslada los precios guardados por nombre a cada producto", async () => {
  // Recreate the previous storage only in the disposable integration database.
  await pool.query(`
    UPDATE app_settings SET config=config || '{"precios":{"Bruschetta":777}}'::jsonb;
    ALTER TABLE products DROP CONSTRAINT products_category_fk;
    UPDATE products SET price_cents=0;
    DELETE FROM schema_migrations WHERE version=10;
  `);
  const schema = await readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(schema);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
  const price = async (name, category) =>
    (await pool.query("SELECT price_cents FROM products WHERE name=$1 AND category=$2", [name, category])).rows[0].price_cents;
  assert.equal(await price("Bruschetta", "entradas"), 777);
  assert.equal(await price("Guacamole", "adicionales"), 500);
  assert.equal(await price("Ensalada", "adicionales"), 1000);
  assert.equal(await price("Pasta", "platos"), 1000);
  assert.equal(await price("Tarta de Queso", "postres"), 400);
  assert.equal((await pool.query("SELECT config ? 'precios' AS kept FROM app_settings")).rows[0].kept, false);
  await assert.rejects(pool.query("UPDATE products SET category='inexistente' WHERE name='Pasta'"), { code: "23503" });
});

test("el límite de ingresos cuenta solo los intentos fallidos y responde JSON", async () => {
  const visitor = client();
  let limited;
  for (let attempt = 0; attempt < 45 && !limited; attempt++) {
    const response = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "inexistente", password: "incorrecta" }),
    });
    if (response.status === 429) limited = await response.json();
    else assert.equal(response.status, 401);
  }
  assert.match(limited.error, /Demasiados intentos/);
  await visitor.login("mesero", password, 429);
});
