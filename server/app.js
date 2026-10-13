import express from "express";
import rateLimit from "express-rate-limit";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool, transaction } from "./db.js";
import { hashPassword, verifyPassword, tokenHash } from "./password.js";
import { tariffFor, totals, amounts, applyDiscount, discountCents } from "../money.js";
import { exampleProductHelp } from "./product-help.js";

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  req.body ??= {};
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    const expected =
      process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
    if (
      (origin && origin !== expected) ||
      req.get("sec-fetch-site") === "cross-site"
    )
      return res.status(403).json({ error: "Origen no permitido." });
  }
  next();
});
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const integer = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max;
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value, max = 500) =>
  typeof value === "string" && value.length <= max;
const sessionCookie = (token, maxAge = 43200) =>
  `comandas_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`;
const dummyHash = hashPassword(randomBytes(24).toString("hex"));
const newPassword = (value) => text(value, 256) && value.length >= 8;
const passwordRule = "La contraseña debe tener entre 8 y 256 caracteres.";
const userRoles = ["admin", "supervisor", "mesero", "estacion", "caja", "auditor"];
// Administrative log: accounts, access and configuration. Order changes go to order_events.
async function audit(db, userId, action, details = {}) {
  await db.query("INSERT INTO audit_events(user_id,action,details) VALUES($1,$2,$3)", [
    userId,
    action,
    details,
  ]);
}
// Devices behind one address share the limit, so correct sign-ins do not consume it.
const attemptLimit = (skipSuccessfulRequests) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests,
    message: { error: "Demasiados intentos. Espera unos minutos y vuelve a intentar." },
  });
async function assignedStations(userId, db = pool) {
  return (await db.query(
    "SELECT s.code FROM user_stations us JOIN stations s ON s.code=us.station_code WHERE us.user_id=$1 AND s.active=true ORDER BY s.code",
    [userId],
  )).rows.map((s) => s.code);
}
// For the service supervisor and monitoring: answers without a session and checks the database.
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "Base de datos no disponible." });
  }
});
app.post(
  "/api/login",
  attemptLimit(true),
  async (req, res) => {
    const { username, password } = req.body;
    if (!text(username, 80) || !text(password, 256))
      fail(400, "Usuario y contraseña requeridos.");
    const {
      rows: [user],
    } = await pool.query(
      "SELECT * FROM users WHERE username=$1 AND active=true",
      [username],
    );
    const valid = verifyPassword(password, user?.password_hash || dummyHash);
    if (user) await audit(pool, user.id, valid ? "login" : "login_failed");
    if (!user || !valid) fail(401, "Usuario o contraseña incorrectos.");
    const token = randomBytes(32).toString("hex");
    await pool.query("DELETE FROM sessions WHERE expires_at <= now()");
    await pool.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
      [tokenHash(token), user.id],
    );
    res.set("Set-Cookie", sessionCookie(token)).json({
      id: user.id,
      username: user.username,
      role: user.role,
      waiter_id: user.waiter_id,
      must_change_password: user.must_change_password,
      stations: await assignedStations(user.id),
    });
  },
);
app.use("/api", async (req, res, next) => {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("comandas_session="));
  const token = cookie?.slice("comandas_session=".length);
  if (!token) return res.status(401).json({ error: "Inicia sesión." });
  const {
    rows: [user],
  } = await pool.query(
    "SELECT u.id,u.username,u.role,u.waiter_id,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true",
    [tokenHash(token)],
  );
  if (!user)
    return res.status(401).json({ error: "La sesión venció. Inicia sesión." });
  req.user = user;
  req.user.stations = await assignedStations(user.id);
  req.sessionHash = tokenHash(token);
  if (user.must_change_password && !["/me", "/password", "/logout"].includes(req.path))
    return res.status(403).json({
      error: "Cambia tu contraseña para continuar.",
      code: "password_change_required",
    });
  next();
});
app.get("/api/me", (req, res) => res.json(req.user));
app.post(
  "/api/password",
  attemptLimit(false),
  async (req, res) => {
    const { current, password } = req.body;
    if (!text(current, 256) || !newPassword(password)) fail(400, passwordRule);
    const {
      rows: [stored],
    } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
    if (!verifyPassword(current, stored.password_hash))
      fail(400, "La contraseña actual no es correcta.");
    if (current === password)
      fail(400, "La nueva contraseña debe ser distinta de la actual.");
    await transaction(async (db) => {
      await db.query(
        "UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2",
        [hashPassword(password), req.user.id],
      );
      // The other devices of this user must sign in with the new password.
      await db.query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", [
        req.user.id,
        req.sessionHash,
      ]);
      await audit(db, req.user.id, "password_changed");
    });
    res.json({ ok: true });
  },
);

app.get("/api/customers", async (req, res) => {
  if (!["caja", "admin"].includes(req.user.role)) fail(403, "Acceso solo para Caja y administrador.");
  const identification = req.query.identification;
  if (!text(identification, 200) || !identification.trim()) fail(400, "Identificación requerida.");
  const { rows: [account] } = await pool.query(
    "SELECT a.customer FROM order_accounts a JOIN orders o ON o.id=a.order_id WHERE btrim(a.customer->>'identification')=$1 AND btrim(COALESCE(a.customer->>'name',''))<>'' ORDER BY o.number DESC,a.number DESC LIMIT 1",
    [identification.trim()],
  );
  res.json({ customer: account?.customer ?? null });
});
app.post("/api/logout", async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
    req.sessionHash,
  ]);
  res.set("Set-Cookie", sessionCookie("", 0)).json({ ok: true });
});

// PostgreSQL notifications allow multiple backend instances to notify their clients.
const streams = new Set();
export function notifyClients() {
  for (const stream of streams) stream.write("event: changed\ndata: {}\n\n");
}
app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  streams.add(res);
  res.write("event: changed\ndata: {}\n\n");
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20000);
  const expire = setTimeout(() => res.end(), 12 * 60 * 60 * 1000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(expire);
    streams.delete(res);
  });
});
app.get("/api/state", async (req, res) => {
  const state = await transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = (
      await db.query("SELECT number,zone,active FROM dining_tables ORDER BY number")
    ).rows;
    const categories = (
      await db.query("SELECT * FROM categories ORDER BY position,name")
    ).rows;
    const products = (
      await db.query("SELECT * FROM products ORDER BY category,name")
    ).rows;
    const orders = (
      await db.query(
        "SELECT * FROM orders WHERE status<>'closed' ORDER BY number",
      )
    ).rows;
    const items = (
      await db.query(
        "SELECT i.* FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status<>'closed' ORDER BY i.sent_at NULLS FIRST,i.id",
      )
    ).rows;
    const accounts = (
      await db.query(
        "SELECT a.* FROM order_accounts a JOIN orders o ON o.id=a.order_id WHERE o.status<>'closed' ORDER BY a.number",
      )
    ).rows;
    const voids = (
      await db.query(
        "SELECT v.*,u.username FROM order_item_voids v JOIN orders o ON o.id=v.order_id JOIN users u ON u.id=v.voided_by WHERE o.status<>'closed' ORDER BY v.id",
      )
    ).rows;
    const waiters = (await db.query("SELECT * FROM waiters ORDER BY name"))
      .rows;
    const settings = (await db.query("SELECT * FROM app_settings WHERE id=1"))
      .rows[0];
    return {
      stations: (await db.query("SELECT * FROM stations ORDER BY code")).rows,
      ...(req.user.role === "admin" ? { users: (await db.query(
        "SELECT u.id,u.username,u.role,u.waiter_id,u.active,u.must_change_password,ARRAY(SELECT station_code FROM user_stations WHERE user_id=u.id ORDER BY station_code) AS stations FROM users u ORDER BY username",
      )).rows } : {}),
      tables,
      categories,
      products: products.map((p) => ({ ...p, help: exampleProductHelp(p) })),
      waiters,
      settings,
      orders: orders.map((o) => {
        const maySeeCustomer =
          ["admin", "supervisor", "caja", "auditor"].includes(req.user.role) ||
          (req.user.role === "mesero" &&
            (!o.waiter_id || o.waiter_id === req.user.waiter_id));
        return {
          ...o,
          items: items.filter((i) => i.order_id === o.id),
          voids: voids.filter((v) => v.order_id === o.id),
          accounts: accounts
            .filter((a) => a.order_id === o.id)
            .map((a) =>
              maySeeCustomer ? a : { number: a.number, name: a.name },
            ),
        };
      }),
    };
  });
  res.json(state);
});
function allow(user, roles) {
  if (user.role !== "admin" && !roles.includes(user.role))
    fail(403, "Tu rol no permite esta operación.");
}
function ownOrder(user, order) {
  if (
    user.role === "mesero" &&
    order.waiter_id &&
    order.waiter_id !== user.waiter_id
  )
    fail(403, "Esta mesa pertenece a otro mesero.");
}
async function event(db, order, user, action, details = {}) {
  await db.query("UPDATE orders SET version=version+1 WHERE id=$1", [order]);
  await db.query(
    "INSERT INTO order_events(order_id,user_id,action,details) VALUES($1,$2,$3,$4)",
    [order, user, action, details],
  );
  await db.query("SELECT pg_notify('comandas_changed','')");
}
async function addProduct(db, id, b) {
  if (
    !uuid(b.productId) ||
    !integer(b.quantity, 1, 999) ||
    !integer(b.account, 1, 99) ||
    !text(b.note)
  )
    fail(400, "Producto, cantidad, cuenta o nota inválidos.");
  const {
    rows: [p],
  } = await db.query("SELECT p.*,s.active AS station_active,c.active AS category_active FROM products p JOIN stations s ON s.code=p.area JOIN categories c ON c.code=p.category WHERE p.id=$1 FOR SHARE OF p,s", [b.productId]);
  if (!p) fail(404, "Producto no encontrado.");
  if (!p.active || !p.category_active) fail(409, "Este producto ya no está disponible en el menú.");
  if (!p.station_active) fail(409, "La estación de este producto está inactiva.");
  await db.query(
    "INSERT INTO order_accounts(order_id,number) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [id, b.account],
  );
  const {
    rows: [settings],
  } = await db.query("SELECT config FROM app_settings WHERE id=1");
  const tariff = tariffFor(p, settings.config);
  const {
    rows: [draft],
  } = await db.query(
    "SELECT id,quantity FROM order_items WHERE order_id=$1 AND product_id=$2 AND account=$3 AND note=$4 AND tariff=$5::jsonb AND area=$6 AND status='draft' ORDER BY id LIMIT 1",
    [id, p.id, b.account, b.note, tariff, p.area],
  );
  if (draft) {
    if (draft.quantity + b.quantity > 999)
      fail(400, "La cantidad máxima es 999.");
    await db.query(
      "UPDATE order_items SET quantity=quantity+$1 WHERE id=$2",
      [b.quantity, draft.id],
    );
  } else
    await db.query(
      "INSERT INTO order_items(id,order_id,product_id,product_name,area,quantity,account,note,tariff) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        randomUUID(),
        id,
        p.id,
        p.name,
        p.area,
        b.quantity,
        b.account,
        b.note,
        tariff,
      ],
    );
  return { product: p.name, quantity: b.quantity, account: b.account, note: b.note };
}
async function openAccount(db, order, account) {
  if (
    (
      await db.query(
        "SELECT 1 FROM order_accounts WHERE order_id=$1 AND number=$2 AND lsoft<>'{}'::jsonb",
        [order, account],
      )
    ).rowCount
  )
    fail(409, "La cuenta ya fue enviada a LSoft; no admite cambios.");
}
async function waiterLabel(db, id) {
  if (!id) return null;
  return (await db.query("SELECT name FROM waiters WHERE id=$1", [id])).rows[0]?.name ?? null;
}
app.post("/api/orders", async (req, res) => {
  allow(req.user, ["mesero", "supervisor"]);
  const table = req.body.tableNumber ?? null;
  if (table !== null && !integer(table, 1, 999)) fail(400, "Mesa inválida.");
  const occupied = req.body.occupiedExplicitly ?? false;
  if (typeof occupied !== "boolean" || (occupied && table === null))
    fail(400, "La ocupación requiere una mesa.");
  const order = await transaction(async (db) => {
    if (table !== null) {
      const {
        rows: [seat],
      } = await db.query("SELECT active FROM dining_tables WHERE number=$1 FOR SHARE", [table]);
      if (!seat) fail(400, "La mesa o el registro no existe.");
      if (!seat.active) fail(409, "Esta mesa está desactivada.");
    }
    const id = randomUUID();
    const waiter =
      ["admin", "supervisor"].includes(req.user.role)
        ? (req.body.waiterId ?? null)
        : req.user.waiter_id;
    if (waiter !== null && !uuid(waiter)) fail(400, "Mesero inválido.");
    if (req.user.role === "supervisor" && !waiter) fail(400, "Selecciona el mesero responsable.");
    if (
      waiter &&
      !(
        await db.query("SELECT id FROM waiters WHERE id=$1 AND active=true", [
          waiter,
        ])
      ).rowCount
    )
      fail(400, "Mesero no disponible.");
    const {
      rows: [order],
    } = await db.query(
      "INSERT INTO orders(id,table_number,created_by,waiter_id,occupied_explicitly) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [id, table, req.user.id, waiter, occupied],
    );
    let details = {};
    if (req.body.firstItem) {
      details = await addProduct(db, id, req.body.firstItem);
      if (req.body.firstAccount) {
        const account = req.body.firstAccount;
        if (!text(account.name, 100)) fail(400, "Nombre de cuenta inválido.");
        await db.query("UPDATE order_accounts SET name=$1 WHERE order_id=$2 AND number=$3",
          [account.name, id, req.body.firstItem.account]);
      }
    }
    await event(db, id, req.user.id, "created", details);
    return order;
  });
  res.status(201).json(order);
});
app.post("/api/orders/:id/actions", async (req, res) => {
  if (!uuid(req.params.id)) fail(400, "Pedido inválido.");
  const { action, version } = req.body;
  const roleActions = {
    add: ["mesero"],
    edit: ["mesero"],
    remove: ["mesero"],
    delete_empty: ["mesero"],
    occupy: ["mesero"],
    release: ["mesero"],
    account: ["mesero", "caja"],
    assign: ["supervisor"],
    send: ["mesero"],
    ready: [],
    pickup: ["mesero"],
    pickup_all: ["mesero"],
    send_lsoft: ["mesero", "caja"],
    pay: [],
    bill: ["mesero", "caja"],
    bill_delivered: ["mesero"],
    collected: ["mesero"],
    documents_received: ["caja"],
    close: ["mesero", "caja"],
    new_consumption: ["mesero", "caja"],
    void: ["mesero"],
    note: ["mesero"],
    move: ["mesero"],
    transfer: ["mesero"],
    discount: ["supervisor"],
    void_seen: [],
  };
  // Station work depends on the assigned stations, not on the role or the owner of the order.
  const stationActions = ["ready", "void_seen"];
  // These changes are validated against the locked order and do not overwrite anyone's work,
  // so the kitchen and the waiter can act on the same table at once without conflicts.
  const versionFree = ["add", "ready", "pickup", "pickup_all", "void_seen"];
  for (const roles of Object.values(roleActions)) {
    if (roles.includes("mesero")) roles.push("supervisor");
  }
  if (!Object.hasOwn(roleActions, action)) fail(400, "Acción inválida.");
  if (!stationActions.includes(action) || !req.user.stations.length)
    allow(req.user, roleActions[action]);
  if (!versionFree.includes(action) && !integer(version, 0, 2147483647)) fail(400, "Versión requerida.");
  const result = await transaction(async (db) => {
    const {
      rows: [order],
    } = await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
      req.params.id,
    ]);
    if (!order) fail(404, "Pedido no encontrado.");
    const permittedWaiterAction =
      ["pickup", "pickup_all", "bill"].includes(action) &&
      (order.table_number === null || req.body.confirmedOtherWaiterId === order.waiter_id);
    if (!permittedWaiterAction && !stationActions.includes(action)) ownOrder(req.user, order);
    if (order.status === "closed") fail(409, "El pedido ya está cerrado.");
    if (!versionFree.includes(action) && order.version !== version)
      fail(
        409,
        "Otro usuario modificó el pedido. Se actualizarán los datos; vuelve a intentar.",
      );
    const id = order.id,
      b = req.body;
    let details = {};
    if (["occupy", "release"].includes(action)) {
      // A table whose products were all voided is released even after asking for the bill.
      if (order.table_number === null || (order.status !== "open" && action === "occupy"))
        fail(409, "Esta acción requiere una mesa abierta.");
      if (action === "occupy") {
        if ((await db.query("SELECT 1 FROM order_items WHERE order_id=$1 LIMIT 1", [id])).rowCount)
          fail(409, "La mesa ya tiene productos; no requiere confirmar la ocupación.");
        await db.query("UPDATE orders SET occupied_explicitly=true WHERE id=$1", [id]);
      } else {
        const contents = await db.query(
          "SELECT 1 FROM order_items WHERE order_id=$1 UNION ALL SELECT 1 FROM order_accounts WHERE order_id=$1 AND lsoft<>'{}'::jsonb",
          [id],
        );
        if (contents.rowCount) fail(409, "Solo puedes liberar una mesa sin productos ni consumo enviado.");
        await db.query("UPDATE orders SET status='closed',closed_at=now() WHERE id=$1", [id]);
      }
    }
    if (["bill_delivered", "collected", "documents_received"].includes(action)) {
      if (order.status !== "bill_requested") fail(409, "Primero solicita la cuenta.");
      if (!integer(b.account, 1, 99)) fail(400, "Cuenta inválida.");
      const { rows: [account] } = await db.query(
        "SELECT * FROM order_accounts WHERE order_id=$1 AND number=$2 AND EXISTS(SELECT 1 FROM order_items WHERE order_id=$1 AND account=$2)", [id, b.account]);
      if (!account) fail(404, "Cuenta no encontrada.");
      const previous = { collected: "bill_delivered", documents_received: "collected" }[action];
      if (previous && !account.collection[previous]) fail(409, "Completa el paso anterior de la cuenta.");
      if (!account.collection[action]) {
        account.collection[action] = { at: new Date().toISOString(), userId: req.user.id };
        await db.query("UPDATE order_accounts SET collection=$1 WHERE order_id=$2 AND number=$3", [account.collection, id, b.account]);
      }
      details = { account: b.account };
    }
    if (action === "delete_empty") {
      if (order.table_number !== null)
        fail(409, "Solo se puede eliminar un pedido para llevar vacío.");
      const contents = await db.query(
        "SELECT 1 FROM order_items WHERE order_id=$1 UNION ALL SELECT 1 FROM order_accounts WHERE order_id=$1 AND lsoft<>'{}'::jsonb",
        [id],
      );
      if (contents.rowCount) fail(409, "El pedido ya tiene productos o una cuenta enviada.");
      if ((await db.query("SELECT 1 FROM order_item_voids WHERE order_id=$1 LIMIT 1", [id])).rowCount) {
        // Voided products stay in the history with their order.
        await db.query("UPDATE orders SET status='closed',closed_at=now() WHERE id=$1", [id]);
        await event(db, id, req.user.id, action);
        return;
      }
      const { rows: events } = await db.query(
        "SELECT e.action,e.details,e.created_at,u.username FROM order_events e JOIN users u ON u.id=e.user_id WHERE e.order_id=$1 ORDER BY e.id",
        [id],
      );
      await db.query("DELETE FROM order_accounts WHERE order_id=$1", [id]);
      await db.query("DELETE FROM order_events WHERE order_id=$1", [id]);
      await db.query("DELETE FROM orders WHERE id=$1", [id]);
      // The removed order keeps its trace in the administrative log.
      await audit(db, req.user.id, "order_deleted", { number: Number(order.number), events });
      await db.query("SELECT pg_notify('comandas_changed','')");
      return;
    }
    if (["add", "edit", "remove", "send"].includes(action)) {
      // An invoiced account is closed; the others keep ordering until every account is invoiced.
      const {
        rows: [billing],
      } = await db.query(
        "SELECT count(*)::int AS items,count(*) FILTER(WHERE a.lsoft IS NOT NULL AND a.lsoft<>'{}'::jsonb)::int AS sent FROM order_items i LEFT JOIN order_accounts a ON a.order_id=i.order_id AND a.number=i.account WHERE i.order_id=$1",
        [id],
      );
      if (billing.items && billing.items === billing.sent)
        fail(409, "Todas las cuentas ya fueron enviadas a LSoft; no admite otra ronda.");
    }
    if (action === "add") {
      if (integer(b.account, 1, 99)) await openAccount(db, id, b.account);
      details = await addProduct(db, id, b);
    }
    if (["edit", "remove", "ready", "pickup", "void", "note", "move"].includes(action)) {
      if (!uuid(b.itemId)) fail(400, "Ítem inválido.");
      const {
        rows: [item],
      } = await db.query(
        "SELECT * FROM order_items WHERE id=$1 AND order_id=$2",
        [b.itemId, id],
      );
      if (!item) fail(404, "Ítem no encontrado.");
      if (action === "ready") {
        if (req.user.role !== "admin" && !(await assignedStations(req.user.id, db)).includes(item.area))
          fail(403, "El ítem pertenece a otra área.");
        if (b.ready !== undefined && typeof b.ready !== "boolean")
          fail(400, "Estado de preparación inválido.");
        const ready = b.ready ?? true;
        if (
          item.status !== (ready ? "preparing" : "ready") ||
          item.picked_up_quantity > 0
        )
          fail(409, "No se puede cambiar la preparación de este producto.");
        await db.query(
          "UPDATE order_items SET status=$1,ready_at=CASE WHEN $1='ready' THEN now() ELSE NULL END WHERE id=$2",
          [ready ? "ready" : "preparing", item.id],
        );
        details = { product: item.product_name, quantity: item.quantity, account: item.account, ready };
      } else if (action === "void") {
        if (item.status === "draft")
          fail(409, "Este producto aún no se envió; quítalo de la orden.");
        if (req.user.role === "mesero" && item.status !== "preparing")
          fail(403, "El producto ya está preparado. Pide a un supervisor que lo anule.");
        if (!integer(b.quantity, 1, item.quantity) || !text(b.reason, 200) || !b.reason.trim())
          fail(400, "Indica la cantidad y el motivo de la anulación.");
        await openAccount(db, id, item.account);
        // Units still waiting at the station are voided before the ones already served.
        const left = item.quantity - b.quantity,
          picked = Math.min(item.picked_up_quantity, left);
        await db.query(
          "INSERT INTO order_item_voids(order_id,item_id,product_id,product_name,area,quantity,account,note,tariff,item_status,picked_up_quantity,reason,voided_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
          [id, item.id, item.product_id, item.product_name, item.area, b.quantity, item.account,
            item.note, item.tariff, item.status, item.picked_up_quantity - picked, b.reason.trim(), req.user.id],
        );
        if (left)
          await db.query("UPDATE order_items SET quantity=$1,picked_up_quantity=$2 WHERE id=$3", [left, picked, item.id]);
        else await db.query("DELETE FROM order_items WHERE id=$1", [item.id]);
        details = {
          product: item.product_name, quantity: b.quantity, account: item.account, reason: b.reason.trim(),
          status: item.status, picked_up: item.picked_up_quantity - picked,
          cents: amounts(item.tariff, b.quantity).total,
        };
      } else if (action === "note") {
        if (item.status !== "preparing")
          fail(409, "Solo puedes cambiar la nota mientras el producto está en preparación.");
        if (!text(b.note)) fail(400, "Nota inválida.");
        if (b.note === item.note) fail(409, "La nota no cambió.");
        await db.query("UPDATE order_items SET note=$1,note_changed_at=now() WHERE id=$2", [b.note, item.id]);
        details = { product: item.product_name, account: item.account, from: item.note, to: b.note };
      } else if (action === "move") {
        if (!integer(b.quantity, 1, item.quantity) || !integer(b.toAccount, 1, 99) || b.toAccount === item.account)
          fail(400, "Cantidad o cuenta de destino inválidas.");
        await openAccount(db, id, item.account);
        await openAccount(db, id, b.toAccount);
        await db.query(
          "INSERT INTO order_accounts(order_id,number) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [id, b.toAccount],
        );
        const left = item.quantity - b.quantity,
          picked = Math.min(item.picked_up_quantity, left);
        if (!left)
          await db.query("UPDATE order_items SET account=$1 WHERE id=$2", [b.toAccount, item.id]);
        else {
          await db.query("UPDATE order_items SET quantity=$1,picked_up_quantity=$2 WHERE id=$3", [left, picked, item.id]);
          await db.query(
            "INSERT INTO order_items(id,order_id,product_id,product_name,area,quantity,account,note,status,sent_at,ready_at,picked_up_quantity,tariff,additional,note_changed_at) SELECT $1,order_id,product_id,product_name,area,$2,$3,note,status,sent_at,ready_at,$4,tariff,additional,note_changed_at FROM order_items WHERE id=$5",
            [randomUUID(), b.quantity, b.toAccount, item.picked_up_quantity - picked, item.id],
          );
        }
        details = { product: item.product_name, quantity: b.quantity, from: item.account, to: b.toAccount };
      } else if (action === "pickup") {
        if (item.status !== "ready")
          fail(409, "El producto aún no está listo para retirar.");
        if (!integer(b.quantity, 1, item.quantity - item.picked_up_quantity))
          fail(400, "Cantidad a retirar inválida.");
        await db.query(
          "UPDATE order_items SET picked_up_quantity=picked_up_quantity+$1 WHERE id=$2",
          [b.quantity, item.id],
        );
        details = { product: item.product_name, quantity: b.quantity, account: item.account };
      } else {
        if (item.status !== "draft")
          fail(409, "Solo puedes editar productos que aún no se enviaron.");
        await openAccount(db, id, item.account);
        if (action === "remove") {
          details = { product: item.product_name, quantity: item.quantity, account: item.account, note: item.note };
          await db.query("DELETE FROM order_items WHERE id=$1", [item.id]);
          if (order.table_number !== null && !order.occupied_explicitly && order.status === "open") {
            const remaining = await db.query(
              "SELECT 1 FROM order_items WHERE order_id=$1 UNION ALL SELECT 1 FROM order_events WHERE order_id=$1 AND action IN ('send','send_lsoft','new_consumption')",
              [id],
            );
            if (!remaining.rowCount) {
              await db.query("UPDATE orders SET status='closed',closed_at=now() WHERE id=$1", [id]);
              await event(db, id, req.user.id, "remove", details);
              await event(db, id, req.user.id, "release", { automatic: true });
              return;
            }
          }
        } else {
          if (!integer(b.quantity, 1, 999) || !text(b.note))
            fail(400, "Cantidad o nota inválidas.");
          await db.query(
            "UPDATE order_items SET quantity=$1,note=$2 WHERE id=$3",
            [b.quantity, b.note, item.id],
          );
          details = {
            product: item.product_name, account: item.account,
            from: { quantity: item.quantity, note: item.note },
            to: { quantity: b.quantity, note: b.note },
          };
        }
      }
    }
    if (action === "pickup_all") {
      if (b.area !== undefined && (!text(b.area, 80) ||
          !(await db.query("SELECT code FROM stations WHERE code=$1", [b.area])).rowCount))
        fail(400, "Área inválida.");
      const { rows: waiting } = await db.query(
        "SELECT product_name AS product,quantity-picked_up_quantity AS quantity,account FROM order_items WHERE order_id=$1 AND status='ready' AND picked_up_quantity<quantity AND ($2::text IS NULL OR area=$2) ORDER BY id",
        [id, b.area ?? null],
      );
      const picked = await db.query(
        "UPDATE order_items SET picked_up_quantity=quantity WHERE order_id=$1 AND status='ready' AND picked_up_quantity<quantity AND ($2::text IS NULL OR area=$2)",
        [id, b.area ?? null],
      );
      if (!picked.rowCount) fail(409, "No hay productos listos para retirar.");
      details = { area: b.area ?? null, items: waiting };
    }
    if (action === "account") {
      if (!integer(b.account, 1, 99) || !text(b.name, 100))
        fail(400, "Cuenta inválida.");
      const customer = b.customer ?? {};
      if (
        typeof customer !== "object" ||
        customer === null ||
        Array.isArray(customer) ||
        Object.keys(customer).some(
          (k) =>
            !["identification", "name", "address", "phone", "email"].includes(
              k,
            ),
        ) ||
        Object.values(customer).some((v) => !text(v, 200))
      )
        fail(400, "Datos del cliente inválidos.");
      const {
        rows: [previous],
      } = await db.query(
        "SELECT * FROM order_accounts WHERE order_id=$1 AND number=$2",
        [id, b.account],
      );
      if (previous?.lsoft?.json)
        fail(409, "Esta cuenta ya fue enviada; sus datos están bloqueados.");
      const tip = b.tipCents ?? previous?.tip_cents ?? 0;
      if (!integer(tip, 0, 10000000)) fail(400, "Propina inválida.");
      await db.query(
        "INSERT INTO order_accounts(order_id,number,name,customer,tip_cents) VALUES($1,$2,$3,$4,$5) ON CONFLICT(order_id,number) DO UPDATE SET name=$3,customer=$4,tip_cents=$5",
        [id, b.account, b.name, customer, tip],
      );
      details = { account: b.account, name: b.name, tip_cents: tip };
    }
    if (action === "assign") {
      if (
        !uuid(b.waiterId) ||
        !(
          await db.query("SELECT id FROM waiters WHERE id=$1 AND active=true", [
            b.waiterId,
          ])
        ).rowCount
      )
        fail(400, "Mesero no disponible.");
      if (
        (
          await db.query(
            "SELECT 1 FROM order_accounts WHERE order_id=$1 AND lsoft<>'{}'::jsonb",
            [id],
          )
        ).rowCount
      )
        fail(409, "El pedido ya fue enviado a LSoft.");
      await db.query("UPDATE orders SET waiter_id=$1 WHERE id=$2", [
        b.waiterId,
        id,
      ]);
      details = { from: await waiterLabel(db, order.waiter_id), to: await waiterLabel(db, b.waiterId) };
    }
    if (action === "discount") {
      if (!integer(b.account, 1, 99) || !["percent", "amount", "none"].includes(b.type))
        fail(400, "Descuento inválido.");
      const {
        rows: [account],
      } = await db.query("SELECT * FROM order_accounts WHERE order_id=$1 AND number=$2", [id, b.account]);
      const { rows: lines } = await db.query(
        "SELECT tariff,quantity FROM order_items WHERE order_id=$1 AND account=$2",
        [id, b.account],
      );
      if (!account || !lines.length) fail(404, "Cuenta no encontrada.");
      await openAccount(db, id, b.account);
      let discount = {};
      if (b.type === "none") {
        if (!account.discount.type) fail(409, "La cuenta no tiene descuento.");
        details = { account: b.account, type: "none" };
      } else {
        const valid =
          b.type === "percent"
            ? typeof b.value === "number" && b.value > 0 && b.value <= 100 && Math.round(b.value * 100) / 100 === b.value
            : integer(b.value, 1, 10000000);
        if (!valid || !text(b.reason, 200) || !b.reason.trim())
          fail(400, "Indica el valor y el motivo del descuento.");
        const gross = totals(lines);
        if (b.type === "amount" && b.value > gross.total)
          fail(400, "El descuento supera el consumo de la cuenta.");
        discount = {
          type: b.type, value: b.value, reason: b.reason.trim(),
          by: req.user.username, at: new Date().toISOString(),
        };
        details = {
          account: b.account, type: b.type, value: b.value, reason: discount.reason,
          cents: discountCents(gross, discount),
        };
      }
      await db.query("UPDATE order_accounts SET discount=$1 WHERE order_id=$2 AND number=$3", [discount, id, b.account]);
    }
    if (action === "transfer") {
      if (order.table_number === null) fail(409, "Solo se puede cambiar de mesa un pedido de mesa.");
      if (!integer(b.tableNumber, 1, 999) || b.tableNumber === order.table_number)
        fail(400, "Mesa de destino inválida.");
      if (
        (
          await db.query(
            "SELECT 1 FROM order_accounts WHERE order_id=$1 AND lsoft<>'{}'::jsonb",
            [id],
          )
        ).rowCount
      )
        fail(409, "El pedido ya fue enviado a LSoft.");
      if (!(await db.query("SELECT 1 FROM dining_tables WHERE number=$1 AND active=true FOR SHARE", [b.tableNumber])).rowCount)
        fail(400, "La mesa de destino no existe o está desactivada.");
      if ((await db.query("SELECT 1 FROM orders WHERE table_number=$1 AND status<>'closed'", [b.tableNumber])).rowCount)
        fail(409, "La mesa de destino está ocupada.");
      await db.query("UPDATE orders SET table_number=$1 WHERE id=$2", [b.tableNumber, id]);
      details = { from: order.table_number, to: b.tableNumber };
    }
    if (action === "void_seen") {
      if (!integer(b.voidId, 1, Number.MAX_SAFE_INTEGER)) fail(400, "Anulación inválida.");
      const {
        rows: [voided],
      } = await db.query("SELECT * FROM order_item_voids WHERE id=$1 AND order_id=$2", [b.voidId, id]);
      if (!voided) fail(404, "Anulación no encontrada.");
      if (req.user.role !== "admin" && !(await assignedStations(req.user.id, db)).includes(voided.area))
        fail(403, "La anulación pertenece a otra área.");
      if (voided.acknowledged_at) fail(409, "La anulación ya fue confirmada.");
      await db.query("UPDATE order_item_voids SET acknowledged_at=now() WHERE id=$1", [voided.id]);
      details = { product: voided.product_name, quantity: voided.quantity };
    }
    if (action === "send_lsoft" || action === "pay") {
      if (!integer(b.account, 1, 99)) fail(400, "Cuenta inválida.");
      details = { account: b.account };
      const {
        rows: [account],
      } = await db.query(
        "SELECT * FROM order_accounts WHERE order_id=$1 AND number=$2",
        [id, b.account],
      );
      const { rows: items } = await db.query(
        "SELECT * FROM order_items WHERE order_id=$1 ORDER BY id",
        [id],
      );
      const lines = items.filter((i) => i.account === b.account);
      if (!account || !lines.length || lines.some((i) => i.status === "draft"))
        fail(409, "Envía los productos antes de enviar la cuenta.");
      if (action === "send_lsoft") {
        if (
          !["identification", "name"].every(
            (k) => text(account.customer[k], 200) && account.customer[k].trim(),
          )
        )
          fail(400, "Completa la cédula / RUC y el nombre del cliente de esta cuenta.");
        const {
          rows: [waiter],
        } = await db.query("SELECT name FROM waiters WHERE id=$1", [
          order.waiter_id,
        ]);
        const gross = totals(lines),
          total = applyDiscount(gross, account.discount);
        const json = {
          version: "0.1-provisional",
          idOperacion: `COM-${id}-C${b.account}`,
          moneda: "USD",
          origen: {
            sistema: "Comandas",
            tipo: order.table_number ? "mesa" : "para_llevar",
            numero: order.table_number ?? Number(order.number),
            cuenta: String(b.account),
            mesero: waiter?.name ?? null,
          },
          cliente: {
            identificacion: account.customer.identification,
            nombre: account.customer.name,
            direccion: account.customer.address,
            telefono: account.customer.phone,
            correo: account.customer.email,
          },
          lineas: lines.map((i, index) => ({
            linea: index + 1,
            productoReferencia: i.product_name,
            cantidad: i.quantity,
            nota: i.note,
            precioUnitarioCentavos: i.tariff.precio,
            incluyeCargos: i.tariff.incluidos,
            ivaPorcentaje: i.tariff.iva,
            servicioPorcentaje: i.tariff.servicio,
            importesCentavos: amounts(i.tariff, i.quantity),
          })),
          // Present only with a discount, so accounts sent earlier keep an identical JSON.
          ...(total.descuento
            ? {
                descuento: {
                  tipo: account.discount.type === "percent" ? "porcentaje" : "monto",
                  valor: account.discount.value,
                  motivo: account.discount.reason,
                  centavos: total.descuento,
                  totalAntesCentavos: gross.total,
                },
              }
            : {}),
          totalesCentavos: {
            ...total,
            propina: account.tip_cents,
            pagar: total.total + account.tip_cents,
          },
        };
        if (
          account.lsoft.json &&
          JSON.stringify(account.lsoft.json) !== JSON.stringify(json)
        ) {
          // JSONB key ordering differs from JavaScript; compare in PostgreSQL.
          const {
            rows: [same],
          } = await db.query("SELECT $1::jsonb=$2::jsonb AS equal", [
            account.lsoft.json,
            json,
          ]);
          if (!same.equal) fail(409, "El pedido cambió después de su envío.");
        }
        details = { account: b.account, cents: json.totalesCentavos.pagar, retry: !!account.lsoft.json };
        if (!account.lsoft.json)
          await db.query(
            "UPDATE order_accounts SET lsoft=$1 WHERE order_id=$2 AND number=$3",
            [
              {
                json,
                response: {
                  pedidoId: `SIM-P-${order.number}-C${b.account}`,
                  facturaId: `SIM-F-${order.number}-C${b.account}`,
                  estado: "pendiente_pago",
                  sri: "no_aplica_simulacion",
                },
              },
              id,
              b.account,
            ],
          );
        await db.query(
          "UPDATE orders SET status='bill_requested' WHERE id=$1",
          [id],
        );
      } else {
        if (!account.lsoft.json)
          fail(409, "Primero envía la cuenta al simulador.");
        if (!["efectivo", "tarjeta", "transferencia"].includes(b.method))
          fail(400, "Medio de pago inválido.");
        details = { account: b.account, method: b.method };
        if (account.lsoft.response.estado !== "pagado") {
          account.lsoft.response = {
            ...account.lsoft.response,
            estado: "pagado",
            medioPago: b.method,
            pagadoEn: new Date().toISOString(),
          };
          await db.query(
            "UPDATE order_accounts SET lsoft=$1 WHERE order_id=$2 AND number=$3",
            [account.lsoft, id, b.account],
          );
        }
      }
    }
    if (action === "send") {
      const sent = await db.query(
        "UPDATE order_items SET status='preparing',sent_at=now(),additional=EXISTS(SELECT 1 FROM order_items previous WHERE previous.order_id=$1 AND previous.status<>'draft') WHERE order_id=$1 AND status='draft' RETURNING product_name AS product,quantity,account,note",
        [id],
      );
      if (!sent.rowCount) fail(409, "No hay productos pendientes de enviar.");
      details = { items: sent.rows };
    }
    if (action === "bill") {
      const {
        rows: [counts],
      } = await db.query(
        "SELECT count(*)::int AS total,count(*) FILTER(WHERE status='draft')::int AS draft FROM order_items WHERE order_id=$1",
        [id],
      );
      if (!counts.total || counts.draft)
        fail(409, "Envía los productos antes de pedir la cuenta.");
      await db.query("UPDATE orders SET status='bill_requested' WHERE id=$1", [
        id,
      ]);
    }
    if (action === "close" || action === "new_consumption") {
      if (action === "new_consumption" && order.table_number === null)
        fail(409, "El nuevo consumo requiere una mesa.");
      if (order.status !== "bill_requested")
        fail(409, "Primero solicita la cuenta.");
      const {
        rows: [counts],
      } = await db.query(
        "SELECT count(*)::int AS total,count(*) FILTER(WHERE status<>'ready')::int AS pending FROM order_items WHERE order_id=$1",
        [id],
      );
      if (!counts.total || counts.pending)
        fail(409, "Hay productos pendientes de preparación.");
      const unsent = await db.query(
        "SELECT 1 FROM order_items i LEFT JOIN order_accounts a ON a.order_id=i.order_id AND a.number=i.account WHERE i.order_id=$1 AND (a.lsoft->'json' IS NULL OR a.lsoft->'json'='null'::jsonb)",
        [id],
      );
      if (unsent.rowCount)
        fail(409, "Envía todas las cuentas a LSoft antes de liberar la mesa.");
      if (action === "new_consumption") {
        const unpaid = await db.query(
          "SELECT 1 FROM order_items i LEFT JOIN order_accounts a ON a.order_id=i.order_id AND a.number=i.account WHERE i.order_id=$1 AND NOT (COALESCE(a.collection->'collected','null'::jsonb)<>'null'::jsonb OR COALESCE(a.lsoft->'response'->>'estado','')='pagado')",
          [id],
        );
        if (unpaid.rowCount)
          fail(409, "Confirma el cobro de todas las cuentas antes de abrir un nuevo consumo.");
      }
      await db.query(
        "UPDATE orders SET status='closed',closed_at=now() WHERE id=$1",
        [id],
      );
      if (action === "new_consumption") {
        const nextId = randomUUID();
        await db.query(
          "INSERT INTO orders(id,table_number,created_by,waiter_id,occupied_explicitly) VALUES($1,$2,$3,$4,true)",
          [nextId, order.table_number, req.user.id, order.waiter_id],
        );
        await event(db, id, req.user.id, action);
        await event(db, nextId, req.user.id, "created");
        return { orderId: nextId };
      }
    }
    await event(db, id, req.user.id, action, details);
  });
  res.json({ ok: true, ...result });
});
app.get("/api/history", async (req, res) => {
  allow(req.user, ["caja", "auditor", "supervisor"]);
  const { rows } = await pool.query(
    "SELECT o.*,COALESCE((SELECT jsonb_agg(i) FROM order_items i WHERE i.order_id=o.id),'[]'::jsonb) AS items,COALESCE((SELECT jsonb_agg(a ORDER BY a.number) FROM order_accounts a WHERE a.order_id=o.id),'[]'::jsonb) AS accounts,COALESCE((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('username',u.username) ORDER BY v.id) FROM order_item_voids v JOIN users u ON u.id=v.voided_by WHERE v.order_id=o.id),'[]'::jsonb) AS voids,COALESCE((SELECT jsonb_agg(jsonb_build_object('action',e.action,'details',e.details,'created_at',e.created_at,'username',u.username) ORDER BY e.id) FROM order_events e JOIN users u ON u.id=e.user_id WHERE e.order_id=o.id),'[]'::jsonb) AS events FROM orders o WHERE status='closed' ORDER BY closed_at DESC LIMIT 100",
  );
  res.json(rows);
});
app.get("/api/orders/:id/events", async (req, res) => {
  allow(req.user, ["supervisor", "caja", "auditor"]);
  if (!uuid(req.params.id)) fail(400, "Pedido inválido.");
  const { rows } = await pool.query(
    "SELECT e.action,e.details,e.created_at,u.username FROM order_events e JOIN users u ON u.id=e.user_id WHERE e.order_id=$1 ORDER BY e.id",
    [req.params.id],
  );
  res.json(rows);
});
// Latest changes of orders and administration, newest first.
app.get("/api/audit", async (req, res) => {
  allow(req.user, ["auditor"]);
  const { rows } = await pool.query(
    "SELECT * FROM (SELECT e.created_at,u.username,e.action,e.details,'pedido' AS scope,o.number::int AS order_number,o.table_number FROM order_events e JOIN users u ON u.id=e.user_id JOIN orders o ON o.id=e.order_id UNION ALL SELECT a.created_at,u.username,a.action,a.details,'administracion',NULL,NULL FROM audit_events a JOIN users u ON u.id=a.user_id) events WHERE $1::text IS NULL OR scope=$1 OR ($1='correcciones' AND action IN ('void','note','move','transfer','remove','edit','assign','discount')) ORDER BY created_at DESC LIMIT 300",
    [["pedido", "administracion", "correcciones"].includes(req.query.scope) ? req.query.scope : null],
  );
  res.json(rows);
});
app.get("/api/users", async (req, res) => {
  allow(req.user, []);
  res.json(
    (
      await pool.query(
        "SELECT u.id,u.username,u.role,u.waiter_id,u.active,u.must_change_password,ARRAY(SELECT station_code FROM user_stations WHERE user_id=u.id ORDER BY station_code) AS stations FROM users u ORDER BY username",
      )
    ).rows,
  );
});
app.post("/api/users", async (req, res) => {
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
app.post("/api/users/:id/password", async (req, res) => {
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
app.post("/api/users/:id/active", async (req, res) => {
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
// A shared configuration version prevents overwriting another administrator's changes.
async function changeConfiguration(version, fn, record) {
  if (!integer(version, 0, 2147483647)) fail(400, "Versión requerida.");
  return transaction(async (db) => {
    const { rows: [settings] } = await db.query("SELECT version FROM app_settings WHERE id=1 FOR UPDATE");
    if (settings.version !== version) fail(409, "Otro usuario cambió la configuración. Actualiza los datos.");
    const result = await fn(db);
    if (record) await audit(db, record.user, record.action, record.details);
    await db.query("UPDATE app_settings SET version=version+1 WHERE id=1");
    await db.query("SELECT pg_notify('comandas_changed','')");
    return result;
  });
}
app.post("/api/stations", async (req, res) => {
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
app.post("/api/stations/:code", async (req, res) => {
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
const cleanName = (value, max) => (text(value, max) && value.trim() ? value.trim() : null);
const price = (value) => integer(value, 0, 10000000);
app.post("/api/categories", async (req, res) => {
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
app.post("/api/categories/:code", async (req, res) => {
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
app.post("/api/products", async (req, res) => {
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
app.post("/api/products/prices", async (req, res) => {
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
app.post("/api/products/station", async (req, res) => {
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
app.post("/api/products/:id", async (req, res) => {
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
app.post("/api/tables", async (req, res) => {
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
app.post("/api/tables/:number", async (req, res) => {
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
app.post("/api/users/:id/stations", async (req, res) => {
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
app.post("/api/users/:id/waiter", async (req, res) => {
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
app.post("/api/users/:id/role", async (req, res) => {
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
app.post("/api/config", async (req, res) => {
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
app.post("/api/product-help", async (req, res) => {
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
app.post("/api/waiters", async (req, res) => {
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
const root = fileURLToPath(new URL("../", import.meta.url));
for (const file of [
  "index.html",
  "scripts.js",
  "styles.css",
  "app.css",
  "money.js",
]) {
  app.get(file === "index.html" ? "/" : `/${file}`, (req, res) =>
    res.sendFile(file, { root }),
  );
}
// Fonts and icons are served locally so the restaurant works without Internet.
app.use("/vendor", express.static(root + "vendor", { maxAge: "30d", fallthrough: false }));
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Ruta no encontrada." }),
);
app.use((error, req, res, next) => {
  if (error.code === "23505")
    return res.status(409).json({
      error: "Esta mesa ya tiene un pedido activo. Actualiza la lista.",
    });
  if (error.code === "23503")
    return res.status(400).json({ error: "La mesa o el registro no existe." });
  const status = error.status || 500;
  if (status >= 500)
    console.error(`${new Date().toISOString()} Error del servidor en ${req.method} ${req.path}:`, error);
  res.status(status).json({
    error: status >= 500 ? "No se pudo completar la operación." : error.message,
  });
});
