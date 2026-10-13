// Administration: users, stations, catalog, tables, charges and the waiter team.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "../db.js";
import { hashPassword } from "../password.js";
import {
  fail,
  integer,
  uuid,
  text,
  newPassword,
  passwordRule,
  userRoles,
  audit,
  allow,
  waiterLabel,
  changeConfiguration,
  cleanName,
  price,
} from "../shared.js";

export const router = Router();
// Shared validation of a product: unique name in its category, existing category, active station.
async function checkProduct(db, product, id = null) {
  if (!(await db.query("SELECT 1 FROM categories WHERE code=$1 FOR SHARE", [product.category])).rowCount)
    fail(400, "Categoría no encontrada.");
  const {
    rows: [station],
  } = await db.query("SELECT active FROM stations WHERE code=$1 FOR SHARE", [product.area]);
  if (!station) fail(400, "Estación no encontrada.");
  if (!station.active && product.area !== product.previousArea) fail(400, "Estación no disponible.");
  if ((await db.query("SELECT 1 FROM products WHERE category=$1 AND lower(name)=lower($2) AND ($3::uuid IS NULL OR id<>$3)",
    [product.category, product.name, id])).rowCount)
    fail(409, "Ya existe un producto con ese nombre en la categoría.");
}
function productFields(body) {
  const product = {
    name: cleanName(body.name, 80),
    category: body.category,
    area: body.stationCode,
    price_cents: body.priceCents,
  };
  if (!product.name || !text(product.category, 80) || !text(product.area, 80) || !price(product.price_cents))
    fail(400, "Nombre, categoría, estación o precio inválidos.");
  return product;
}
router.get("/users", async (req, res) => {
  allow(req.user, []);
  res.json(
    (
      await pool.query(
        "SELECT u.id,u.username,u.role,u.waiter_id,u.active,u.must_change_password,ARRAY(SELECT station_code FROM user_stations WHERE user_id=u.id ORDER BY station_code) AS stations FROM users u ORDER BY username",
      )
    ).rows,
  );
});
router.post("/users", async (req, res) => {
  allow(req.user, []);
  const { username, role, password } = req.body;
  const waiterId = req.body.waiterId ?? null;
  if (!text(username, 40) || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))
    fail(400, "El usuario debe tener de 3 a 40 letras minúsculas, números, puntos o guiones.");
  if (!userRoles.includes(role)) fail(400, "Rol inválido.");
  if (!newPassword(password)) fail(400, passwordRule);
  if (waiterId !== null && (!uuid(waiterId) || !["mesero", "supervisor"].includes(role)))
    fail(400, "Mesero inválido.");
  if (role === "mesero" && !waiterId) fail(400, "Vincula un mesero a este usuario.");
  const created = await transaction(async (db) => {
    if ((await db.query("SELECT 1 FROM users WHERE lower(username)=$1", [username])).rowCount)
      fail(409, "Ya existe un usuario con ese nombre.");
    if (waiterId && !(await db.query("SELECT 1 FROM waiters WHERE id=$1 AND active=true", [waiterId])).rowCount)
      fail(400, "Mesero no disponible.");
    const {
      rows: [user],
    } = await db.query(
      "INSERT INTO users(id,username,password_hash,role,waiter_id,must_change_password) VALUES($1,$2,$3,$4,$5,true) RETURNING id,username,role,waiter_id,active",
      [randomUUID(), username, hashPassword(password), role, waiterId],
    );
    await audit(db, req.user.id, "user_created", { username, role });
    await db.query("SELECT pg_notify('comandas_changed','')");
    return user;
  });
  res.status(201).json(created);
});
router.post("/users/:id/password", async (req, res) => {
  allow(req.user, []);
  if (!uuid(req.params.id)) fail(400, "Usuario inválido.");
  if (!newPassword(req.body.password)) fail(400, passwordRule);
  if (req.params.id === req.user.id)
    fail(400, "Usa «Cambiar contraseña» para tu propia cuenta.");
  await transaction(async (db) => {
    const updated = await db.query(
      "UPDATE users SET password_hash=$1,must_change_password=true WHERE id=$2 RETURNING username",
      [hashPassword(req.body.password), req.params.id],
    );
    if (!updated.rowCount) fail(404, "Usuario no encontrado.");
    await audit(db, req.user.id, "password_reset", { username: updated.rows[0].username });
    await db.query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
    await db.query("SELECT pg_notify('comandas_changed','')");
  });
  res.json({ ok: true });
});
router.post("/users/:id/active", async (req, res) => {
  allow(req.user, []);
  if (!uuid(req.params.id) || typeof req.body.active !== "boolean")
    fail(400, "Usuario inválido.");
  // The acting administrator stays active, so one administrator always remains.
  if (req.params.id === req.user.id) fail(400, "No puedes desactivar tu propia cuenta.");
  await transaction(async (db) => {
    const updated = await db.query("UPDATE users SET active=$1 WHERE id=$2 RETURNING username", [
      req.body.active,
      req.params.id,
    ]);
    if (!updated.rowCount) fail(404, "Usuario no encontrado.");
    await audit(db, req.user.id, req.body.active ? "user_activated" : "user_deactivated", {
      username: updated.rows[0].username,
    });
    if (!req.body.active)
      await db.query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
    await db.query("SELECT pg_notify('comandas_changed','')");
  });
  res.json({ ok: true });
});
router.post("/stations", async (req, res) => {
  allow(req.user, []);
  const { name, version } = req.body;
  if (!text(name, 60) || !name.trim()) fail(400, "Nombre de estación inválido.");
  const station = await changeConfiguration(version, async (db) => {
    if ((await db.query("SELECT 1 FROM stations WHERE lower(name)=lower($1)", [name.trim()])).rowCount)
      fail(409, "Ya existe una estación con ese nombre.");
    return (await db.query("INSERT INTO stations(code,name) VALUES($1,$2) RETURNING *",
      ["station_" + randomUUID().replaceAll("-", ""), name.trim()])).rows[0];
  }, { user: req.user.id, action: "station_created", details: { name: name.trim() } });
  res.status(201).json(station);
});
router.post("/stations/:code", async (req, res) => {
  allow(req.user, []);
  const { name, active, version } = req.body;
  if (!text(name, 60) || !name.trim() || typeof active !== "boolean") fail(400, "Estación inválida.");
  await changeConfiguration(version, async (db) => {
    const { rows: [station] } = await db.query("SELECT * FROM stations WHERE code=$1 FOR UPDATE", [req.params.code]);
    if (!station) fail(404, "Estación no encontrada.");
    if ((await db.query("SELECT 1 FROM stations WHERE lower(name)=lower($1) AND code<>$2", [name.trim(), station.code])).rowCount)
      fail(409, "Ya existe una estación con ese nombre.");
    if (!active) {
      if ((await db.query("SELECT 1 FROM products WHERE area=$1 LIMIT 1", [station.code])).rowCount)
        fail(409, "Reasigna los productos antes de desactivar esta estación.");
      if ((await db.query("SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.area=$1 AND o.status<>'closed' AND i.picked_up_quantity<i.quantity LIMIT 1", [station.code])).rowCount)
        fail(409, "Hay productos pendientes de preparar o retirar en esta estación.");
    }
    await db.query("UPDATE stations SET name=$1,active=$2 WHERE code=$3", [name.trim(), active, station.code]);
  }, { user: req.user.id, action: "station_changed", details: { code: req.params.code, name: name.trim(), active } });
  res.json({ ok: true });
});
router.post("/categories", async (req, res) => {
  allow(req.user, []);
  const name = cleanName(req.body.name, 60);
  if (!name) fail(400, "Nombre de categoría inválido.");
  const category = await changeConfiguration(req.body.version, async (db) => {
    if ((await db.query("SELECT 1 FROM categories WHERE lower(name)=lower($1)", [name])).rowCount)
      fail(409, "Ya existe una categoría con ese nombre.");
    return (await db.query(
      "INSERT INTO categories(code,name,position) VALUES($1,$2,(SELECT COALESCE(max(position),0)+1 FROM categories)) RETURNING *",
      ["cat_" + randomUUID().replaceAll("-", ""), name],
    )).rows[0];
  }, { user: req.user.id, action: "category_created", details: { name } });
  res.status(201).json(category);
});
router.post("/categories/:code", async (req, res) => {
  allow(req.user, []);
  const name = cleanName(req.body.name, 60),
    { position, active } = req.body;
  if (!name || !integer(position, 0, 999) || typeof active !== "boolean")
    fail(400, "Categoría inválida.");
  await changeConfiguration(req.body.version, async (db) => {
    if (!(await db.query("SELECT 1 FROM categories WHERE code=$1 FOR UPDATE", [req.params.code])).rowCount)
      fail(404, "Categoría no encontrada.");
    if ((await db.query("SELECT 1 FROM categories WHERE lower(name)=lower($1) AND code<>$2", [name, req.params.code])).rowCount)
      fail(409, "Ya existe una categoría con ese nombre.");
    await db.query("UPDATE categories SET name=$1,position=$2,active=$3 WHERE code=$4", [name, position, active, req.params.code]);
  }, { user: req.user.id, action: "category_changed", details: { name, position, active } });
  res.json({ ok: true });
});
router.post("/products", async (req, res) => {
  allow(req.user, []);
  const product = productFields(req.body);
  const created = await changeConfiguration(req.body.version, async (db) => {
    await checkProduct(db, product);
    return (await db.query(
      "INSERT INTO products(id,name,category,area,price_cents) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [randomUUID(), product.name, product.category, product.area, product.price_cents],
    )).rows[0];
  }, { user: req.user.id, action: "product_created", details: product });
  res.status(201).json(created);
});
router.post("/products/prices", async (req, res) => {
  allow(req.user, []);
  const { prices } = req.body;
  if (!prices || typeof prices !== "object" || Array.isArray(prices))
    fail(400, "Precios inválidos.");
  const entries = Object.entries(prices);
  if (!entries.length || entries.length > 2000 || entries.some(([id, value]) => !uuid(id) || !price(value)))
    fail(400, "Precios inválidos.");
  const changes = [];
  await changeConfiguration(req.body.version, async (db) => {
    const { rows } = await db.query("SELECT id,name,price_cents FROM products WHERE id=ANY($1::uuid[]) FOR UPDATE", [entries.map(([id]) => id)]);
    if (rows.length !== entries.length) fail(404, "Producto no encontrado.");
    for (const product of rows) {
      const next = prices[product.id];
      if (next === product.price_cents) continue;
      await db.query("UPDATE products SET price_cents=$1 WHERE id=$2", [next, product.id]);
      changes.push({ product: product.name, from: product.price_cents, to: next });
    }
    // The record is written inside the same transaction, after the changes are known.
    if (changes.length) await audit(db, req.user.id, "prices_changed", { changes });
  });
  res.json({ ok: true, changed: changes.length });
});
router.post("/products/station", async (req, res) => {
  allow(req.user, []);
  const { productIds, stationCode, version } = req.body;
  if (!Array.isArray(productIds) || !productIds.length || productIds.length>500 ||
      productIds.some((id) => !uuid(id)) || new Set(productIds).size!==productIds.length || !text(stationCode,80))
    fail(400, "Productos o estación inválidos.");
  await changeConfiguration(version, async (db) => {
    if (!(await db.query("SELECT code FROM stations WHERE code=$1 AND active=true FOR SHARE", [stationCode])).rowCount)
      fail(400, "Estación no disponible.");
    const result = await db.query("UPDATE products SET area=$1 WHERE id=ANY($2::uuid[])", [stationCode, productIds]);
    if (result.rowCount !== productIds.length) fail(404, "Producto no encontrado.");
  }, { user: req.user.id, action: "products_station", details: { station: stationCode, products: productIds.length } });
  res.json({ ok: true });
});
router.post("/products/:id", async (req, res) => {
  allow(req.user, []);
  if (!uuid(req.params.id) || typeof req.body.active !== "boolean") fail(400, "Producto inválido.");
  const product = productFields(req.body),
    details = {};
  await changeConfiguration(req.body.version, async (db) => {
    const {
      rows: [before],
    } = await db.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!before) fail(404, "Producto no encontrado.");
    await checkProduct(db, { ...product, previousArea: before.area }, before.id);
    await db.query(
      "UPDATE products SET name=$1,category=$2,area=$3,price_cents=$4,active=$5 WHERE id=$6",
      [product.name, product.category, product.area, product.price_cents, req.body.active, before.id],
    );
    const after = { ...product, active: req.body.active };
    details.product = before.name;
    for (const key of Object.keys(after))
      if (after[key] !== before[key]) details[key] = { from: before[key], to: after[key] };
    await audit(db, req.user.id, "product_changed", details);
  });
  res.json({ ok: true });
});
router.post("/tables", async (req, res) => {
  allow(req.user, []);
  const { number } = req.body,
    zone = req.body.zone ?? "";
  if (!integer(number, 1, 999) || !text(zone, 40)) fail(400, "Número o zona de mesa inválidos.");
  const table = await changeConfiguration(req.body.version, async (db) => {
    if ((await db.query("SELECT 1 FROM dining_tables WHERE number=$1", [number])).rowCount)
      fail(409, "Ya existe una mesa con ese número.");
    return (await db.query("INSERT INTO dining_tables(number,zone) VALUES($1,$2) RETURNING *", [number, zone.trim()])).rows[0];
  }, { user: req.user.id, action: "table_created", details: { number, zone: zone.trim() } });
  res.status(201).json(table);
});
router.post("/tables/:number", async (req, res) => {
  allow(req.user, []);
  const number = Number(req.params.number),
    { zone, active } = req.body;
  if (!integer(number, 1, 999) || !text(zone, 40) || typeof active !== "boolean")
    fail(400, "Mesa inválida.");
  await changeConfiguration(req.body.version, async (db) => {
    if (!(await db.query("SELECT 1 FROM dining_tables WHERE number=$1 FOR UPDATE", [number])).rowCount)
      fail(404, "Mesa no encontrada.");
    if (!active && (await db.query("SELECT 1 FROM orders WHERE table_number=$1 AND status<>'closed'", [number])).rowCount)
      fail(409, "La mesa tiene un pedido activo. Libérala antes de desactivarla.");
    await db.query("UPDATE dining_tables SET zone=$1,active=$2 WHERE number=$3", [zone.trim(), active, number]);
  }, { user: req.user.id, action: "table_changed", details: { number, zone: zone.trim(), active } });
  res.json({ ok: true });
});
router.post("/users/:id/stations", async (req, res) => {
  allow(req.user, []);
  const { stations, version } = req.body;
  if (!uuid(req.params.id) || !Array.isArray(stations) || stations.length>100 ||
      stations.some((code) => !text(code,80)) || new Set(stations).size!==stations.length)
    fail(400, "Asignaciones inválidas.");
  await changeConfiguration(version, async (db) => {
    if (!(await db.query("SELECT id FROM users WHERE id=$1", [req.params.id])).rowCount)
      fail(404, "Usuario no encontrado.");
    if ((await db.query("SELECT code FROM stations WHERE code=ANY($1::text[])", [stations])).rowCount !== stations.length)
      fail(400, "Estación no encontrada.");
    await db.query("DELETE FROM user_stations WHERE user_id=$1", [req.params.id]);
    for (const code of stations) await db.query("INSERT INTO user_stations(user_id,station_code) VALUES($1,$2)", [req.params.id,code]);
  }, { user: req.user.id, action: "user_stations", details: { user: req.params.id, stations } });
  res.json({ ok: true });
});
router.post("/users/:id/waiter", async (req, res) => {
  allow(req.user, []);
  if (!uuid(req.params.id) || !uuid(req.body.waiterId))
    fail(400, "Usuario o mesero inválido.");
  await transaction(async (db) => {
    if (
      !(
        await db.query("SELECT 1 FROM waiters WHERE id=$1 AND active=true", [
          req.body.waiterId,
        ])
      ).rowCount
    )
      fail(400, "Mesero no disponible.");
    if (
      !(
        await db.query(
          "UPDATE users SET waiter_id=$1 WHERE id=$2 AND role IN ('mesero','supervisor')",
          [req.body.waiterId, req.params.id],
        )
      ).rowCount
    )
      fail(404, "Usuario mesero no encontrado.");
    await audit(db, req.user.id, "user_waiter", {
      user: req.params.id,
      waiter: await waiterLabel(db, req.body.waiterId),
    });
    await db.query("SELECT pg_notify('comandas_changed','')");
  });
  res.json({ ok: true });
});
router.post("/users/:id/role", async (req, res) => {
  allow(req.user, []);
  const { role, version } = req.body;
  if (!uuid(req.params.id) || !["mesero", "supervisor"].includes(role))
    fail(400, "Rol de salón inválido.");
  await changeConfiguration(version, async (db) => {
    const { rows: [user] } = await db.query("SELECT role,waiter_id FROM users WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!user) fail(404, "Usuario no encontrado.");
    if (!["mesero", "supervisor"].includes(user.role)) fail(400, "Solo puedes cambiar entre Mesero y Supervisor.");
    if (role === "mesero" && !user.waiter_id) fail(400, "Vincula un mesero antes de cambiar este rol.");
    await db.query("UPDATE users SET role=$1 WHERE id=$2", [role, req.params.id]);
  }, { user: req.user.id, action: "user_role", details: { user: req.params.id, role } });
  res.json({ ok: true });
});
router.post("/config", async (req, res) => {
  allow(req.user, []);
  const { version, config } = req.body;
  if (
    !integer(version, 0, 2147483647) ||
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    !["iva", "servicio"].every(
      (k) =>
        typeof config[k] === "number" &&
        Number.isFinite(config[k]) &&
        config[k] >= 0 &&
        config[k] <= 100,
    ) ||
    typeof config.incluidos !== "boolean"
  )
    fail(400, "Configuración inválida.");
  await transaction(async (db) => {
    const {
      rows: [settings],
    } = await db.query("SELECT * FROM app_settings WHERE id=1 FOR UPDATE");
    if (settings.version !== version)
      fail(409, "Otro usuario cambió la configuración. Actualiza los datos.");
    await db.query(
      "UPDATE app_settings SET config=$1,version=version+1 WHERE id=1",
      [
        {
          iva: config.iva,
          servicio: config.servicio,
          incluidos: config.incluidos,
          ...(settings.config.productHelp ? { productHelp: settings.config.productHelp } : {}),
        },
      ],
    );
    const before = settings.config;
    await audit(db, req.user.id, "config_changed", {
      ...Object.fromEntries(
        ["iva", "servicio", "incluidos"]
          .filter((key) => before[key] !== config[key])
          .map((key) => [key, { from: before[key], to: config[key] }]),
      ),
    });
    await db.query("SELECT pg_notify('comandas_changed','')");
  });
  res.json({ ok: true });
});
router.post("/product-help", async (req, res) => {
  allow(req.user, []);
  const { productId, version, info } = req.body;
  const keys = ["ingredients", "preparation", "sides"];
  if (!uuid(productId) || !integer(version, 0, 2147483647) ||
      !info || typeof info !== "object" || Array.isArray(info) ||
      !keys.every((key) => text(info[key], 600)))
    fail(400, "Ficha de producto inválida.");
  await transaction(async (db) => {
    const { rows: [settings] } = await db.query("SELECT * FROM app_settings WHERE id=1 FOR UPDATE");
    if (settings.version !== version)
      fail(409, "La configuración cambió. Cierra la ayuda y vuelve a abrirla.");
    if (!(await db.query("SELECT id FROM products WHERE id=$1", [productId])).rowCount)
      fail(404, "Producto no encontrado.");
    const productHelp = { ...settings.config.productHelp,
      [productId]: Object.fromEntries(keys.map((key) => [key, info[key].trim()])),
    };
    await db.query("UPDATE app_settings SET config=$1,version=version+1 WHERE id=1", [
      { ...settings.config, productHelp },
    ]);
    await audit(db, req.user.id, "product_help", { product: productId });
    await db.query("SELECT pg_notify('comandas_changed','')");
  });
  res.json({ ok: true });
});
router.post("/waiters", async (req, res) => {
  allow(req.user, []);
  const { names, version } = req.body;
  if (
    !integer(version, 0, 2147483647) ||
    !Array.isArray(names) ||
    !names.length ||
    names.length > 50 ||
    new Set(names).size !== names.length ||
    names.some(
      (name) => !text(name, 60) || !name.trim() || name !== name.trim(),
    )
  )
    fail(400, "Lista de meseros inválida.");
  await transaction(async (db) => {
    const {
      rows: [settings],
    } = await db.query("SELECT * FROM app_settings WHERE id=1 FOR UPDATE");
    if (settings.version !== version)
      fail(409, "Otro usuario cambió la configuración. Actualiza los datos.");
    await db.query("UPDATE waiters SET active=false");
    for (const name of names)
      await db.query(
        "INSERT INTO waiters(id,name) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET active=true",
        [randomUUID(), name],
      );
    await db.query("UPDATE app_settings SET version=version+1 WHERE id=1");
    await audit(db, req.user.id, "waiters_changed", { names });
    await db.query("SELECT pg_notify('comandas_changed','')");
  });
  res.json({ ok: true });
});
