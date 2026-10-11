import express from "express";
import rateLimit from "express-rate-limit";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool, transaction } from "./db.js";
import { hashPassword, verifyPassword, tokenHash } from "./password.js";
import { tariffFor, totals, amounts } from "../money.js";
import { exampleProductHelp } from "./product-help.js";

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
async function assignedStations(userId, db = pool) {
  return (await db.query(
    "SELECT s.code FROM user_stations us JOIN stations s ON s.code=us.station_code WHERE us.user_id=$1 AND s.active=true ORDER BY s.code",
    [userId],
  )).rows.map((s) => s.code);
}
app.post(
  "/api/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
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
    "SELECT u.id,u.username,u.role,u.waiter_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true",
    [tokenHash(token)],
  );
  if (!user)
    return res.status(401).json({ error: "La sesión venció. Inicia sesión." });
  req.user = user;
  req.user.stations = await assignedStations(user.id);
  req.sessionHash = tokenHash(token);
  next();
});
app.get("/api/me", (req, res) => res.json(req.user));

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
      await db.query("SELECT number FROM dining_tables ORDER BY number")
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
        "SELECT a.* FROM order_accounts a JOIN orders o ON o.id=a.order_id WHERE o.status<>'closed'",
      )
    ).rows;
    const waiters = (await db.query("SELECT * FROM waiters ORDER BY name"))
      .rows;
    const settings = (await db.query("SELECT * FROM app_settings WHERE id=1"))
      .rows[0];
    return {
      stations: (await db.query("SELECT * FROM stations ORDER BY code")).rows,
      ...(req.user.role === "admin" ? { users: (await db.query(
        "SELECT u.id,u.username,u.role,u.waiter_id,u.active,ARRAY(SELECT station_code FROM user_stations WHERE user_id=u.id ORDER BY station_code) AS stations FROM users u ORDER BY username",
      )).rows } : {}),
      tables,
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
async function event(db, order, user, action) {
  await db.query("UPDATE orders SET version=version+1 WHERE id=$1", [order]);
  await db.query(
    "INSERT INTO order_events(order_id,user_id,action) VALUES($1,$2,$3)",
    [order, user, action],
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
  } = await db.query("SELECT p.*,s.active AS station_active FROM products p JOIN stations s ON s.code=p.area WHERE p.id=$1 FOR SHARE OF p,s", [b.productId]);
  if (!p) fail(404, "Producto no encontrado.");
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
}
app.post("/api/orders", async (req, res) => {
  allow(req.user, ["mesero", "supervisor"]);
  const table = req.body.tableNumber ?? null;
  if (table !== null && !integer(table, 1, 999)) fail(400, "Mesa inválida.");
  const occupied = req.body.occupiedExplicitly ?? false;
  if (typeof occupied !== "boolean" || (occupied && table === null))
    fail(400, "La ocupación requiere una mesa.");
  const order = await transaction(async (db) => {
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
    if (req.body.firstItem) {
      await addProduct(db, id, req.body.firstItem);
      if (req.body.firstAccount) {
        const account = req.body.firstAccount;
        if (!text(account.name, 100)) fail(400, "Nombre de cuenta inválido.");
        await db.query("UPDATE order_accounts SET name=$1 WHERE order_id=$2 AND number=$3",
          [account.name, id, req.body.firstItem.account]);
      }
    }
    await event(db, id, req.user.id, "created");
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
  };
  for (const roles of Object.values(roleActions)) {
    if (roles.includes("mesero")) roles.push("supervisor");
  }
  if (!Object.hasOwn(roleActions, action)) fail(400, "Acción inválida.");
  if (action !== "ready" || !req.user.stations.length)
    allow(req.user, roleActions[action]);
  if (!integer(version, 0, 2147483647)) fail(400, "Versión requerida.");
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
    if (!permittedWaiterAction && action !== "ready") ownOrder(req.user, order);
    if (order.status === "closed") fail(409, "El pedido ya está cerrado.");
    if (order.version !== version)
      fail(
        409,
        "Otro usuario modificó el pedido. Se actualizarán los datos; vuelve a intentar.",
      );
    const id = order.id,
      b = req.body;
    if (["occupy", "release"].includes(action)) {
      if (order.table_number === null || order.status !== "open")
        fail(409, "Esta acción requiere una mesa abierta.");
      if (action === "occupy") {
        await db.query("UPDATE orders SET occupied_explicitly=true WHERE id=$1", [id]);
      } else {
        const contents = await db.query(
          "SELECT 1 FROM order_items WHERE order_id=$1 UNION ALL SELECT 1 FROM order_accounts WHERE order_id=$1 AND lsoft<>'{}'::jsonb UNION ALL SELECT 1 FROM order_events WHERE order_id=$1 AND action IN ('send','send_lsoft','new_consumption')",
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
    }
    if (action === "delete_empty") {
      if (order.table_number !== null || order.status !== "open")
        fail(409, "Solo se puede eliminar un pedido para llevar vacío.");
      const contents = await db.query(
        "SELECT 1 FROM order_items WHERE order_id=$1 UNION ALL SELECT 1 FROM order_accounts WHERE order_id=$1 AND lsoft<>'{}'::jsonb",
        [id],
      );
      if (contents.rowCount) fail(409, "El pedido ya tiene productos o una cuenta enviada.");
      await db.query("DELETE FROM order_accounts WHERE order_id=$1", [id]);
      await db.query("DELETE FROM order_events WHERE order_id=$1", [id]);
      await db.query("DELETE FROM orders WHERE id=$1", [id]);
      await db.query("SELECT pg_notify('comandas_changed','')");
      return;
    }
    if (
      ["add", "edit", "remove", "send"].includes(action) &&
      (
        await db.query(
          "SELECT 1 FROM order_accounts WHERE order_id=$1 AND lsoft<>'{}'::jsonb",
          [id],
        )
      ).rowCount
    )
      fail(409, "El pedido ya fue enviado a LSoft; no admite otra ronda.");
    if (action === "add") await addProduct(db, id, b);
    if (["edit", "remove", "ready", "pickup"].includes(action)) {
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
      } else if (action === "pickup") {
        if (item.status !== "ready")
          fail(409, "El producto aún no está listo para retirar.");
        if (!integer(b.quantity, 1, item.quantity - item.picked_up_quantity))
          fail(400, "Cantidad a retirar inválida.");
        await db.query(
          "UPDATE order_items SET picked_up_quantity=picked_up_quantity+$1 WHERE id=$2",
          [b.quantity, item.id],
        );
      } else {
        if (item.status !== "draft")
          fail(409, "Solo puedes editar productos que aún no se enviaron.");
        if (action === "remove") {
          await db.query("DELETE FROM order_items WHERE id=$1", [item.id]);
          if (order.table_number !== null && !order.occupied_explicitly && order.status === "open") {
            const remaining = await db.query(
              "SELECT 1 FROM order_items WHERE order_id=$1 UNION ALL SELECT 1 FROM order_events WHERE order_id=$1 AND action IN ('send','send_lsoft','new_consumption')",
              [id],
            );
            if (!remaining.rowCount) {
              await db.query("UPDATE orders SET status='closed',closed_at=now() WHERE id=$1", [id]);
              await event(db, id, req.user.id, "release");
            }
          }
        } else {
          if (!integer(b.quantity, 1, 999) || !text(b.note))
            fail(400, "Cantidad o nota inválidas.");
          await db.query(
            "UPDATE order_items SET quantity=$1,note=$2 WHERE id=$3",
            [b.quantity, b.note, item.id],
          );
        }
      }
    }
    if (action === "pickup_all") {
      if (b.area !== undefined && (!text(b.area, 80) ||
          !(await db.query("SELECT code FROM stations WHERE code=$1", [b.area])).rowCount))
        fail(400, "Área inválida.");
      const picked = await db.query(
        "UPDATE order_items SET picked_up_quantity=quantity WHERE order_id=$1 AND status='ready' AND picked_up_quantity<quantity AND ($2::text IS NULL OR area=$2)",
        [id, b.area ?? null],
      );
      if (!picked.rowCount) fail(409, "No hay productos listos para retirar.");
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
    }
    if (action === "send_lsoft" || action === "pay") {
      if (!integer(b.account, 1, 99)) fail(400, "Cuenta inválida.");
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
      if (!account || !lines.length || items.some((i) => i.status === "draft"))
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
        const total = totals(lines);
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
        "UPDATE order_items SET status='preparing',sent_at=now(),additional=EXISTS(SELECT 1 FROM order_items previous WHERE previous.order_id=$1 AND previous.status<>'draft') WHERE order_id=$1 AND status='draft'",
        [id],
      );
      if (!sent.rowCount) fail(409, "No hay productos pendientes de enviar.");
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
    await event(db, id, req.user.id, action);
  });
  res.json({ ok: true, ...result });
});
app.get("/api/history", async (req, res) => {
  allow(req.user, ["caja", "auditor", "supervisor"]);
  const { rows } = await pool.query(
    "SELECT o.*,COALESCE((SELECT jsonb_agg(i) FROM order_items i WHERE i.order_id=o.id),'[]'::jsonb) AS items,COALESCE((SELECT jsonb_agg(a) FROM order_accounts a WHERE a.order_id=o.id),'[]'::jsonb) AS accounts FROM orders o WHERE status='closed' ORDER BY closed_at DESC LIMIT 100",
  );
  res.json(rows);
});
app.get("/api/users", async (req, res) => {
  allow(req.user, []);
  res.json(
    (
      await pool.query(
        "SELECT u.id,u.username,u.role,u.waiter_id,u.active,ARRAY(SELECT station_code FROM user_stations WHERE user_id=u.id ORDER BY station_code) AS stations FROM users u ORDER BY username",
      )
    ).rows,
  );
});
// A shared configuration version prevents overwriting another administrator's changes.
async function changeConfiguration(version, fn) {
  if (!integer(version, 0, 2147483647)) fail(400, "Versión requerida.");
  return transaction(async (db) => {
    const { rows: [settings] } = await db.query("SELECT version FROM app_settings WHERE id=1 FOR UPDATE");
    if (settings.version !== version) fail(409, "Otro usuario cambió la configuración. Actualiza los datos.");
    const result = await fn(db);
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
  });
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
  });
  res.json({ ok: true });
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
  });
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
  });
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
  });
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
    typeof config.incluidos !== "boolean" ||
    !config.precios ||
    typeof config.precios !== "object" ||
    Array.isArray(config.precios) ||
    Object.values(config.precios).some((v) => !integer(v, 0, 10000000))
  )
    fail(400, "Configuración inválida.");
  await transaction(async (db) => {
    const {
      rows: [settings],
    } = await db.query("SELECT * FROM app_settings WHERE id=1 FOR UPDATE");
    if (settings.version !== version)
      fail(409, "Otro usuario cambió la configuración. Actualiza los datos.");
    const names = new Set(
      (await db.query("SELECT name FROM products")).rows.map((p) => p.name),
    );
    if (Object.keys(config.precios).some((name) => !names.has(name)))
      fail(400, "Producto no encontrado.");
    await db.query(
      "UPDATE app_settings SET config=$1,version=version+1 WHERE id=1",
      [
        {
          iva: config.iva,
          servicio: config.servicio,
          incluidos: config.incluidos,
          precios: config.precios,
          ...(settings.config.productHelp ? { productHelp: settings.config.productHelp } : {}),
        },
      ],
    );
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
    console.error("Error del servidor:", error.code || error.message);
  res.status(status).json({
    error: status >= 500 ? "No se pudo completar la operación." : error.message,
  });
});
