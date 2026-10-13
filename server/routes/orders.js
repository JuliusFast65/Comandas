// Orders: creation and every action on an order, inside one transaction with the order locked.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { transaction } from "../db.js";
import { tariffFor, totals, amounts, applyDiscount, discountCents } from "../../money.js";
import {
  fail,
  integer,
  uuid,
  text,
  audit,
  assignedStations,
  allow,
  ownOrder,
  waiterLabel,
} from "../shared.js";

export const router = Router();
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
router.post("/orders", async (req, res) => {
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
router.post("/orders/:id/actions", async (req, res) => {
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
