// Shared state of the restaurant and the event stream that announces its changes.
import { Router } from "express";
import { transaction } from "../db.js";
import { exampleProductHelp } from "../product-help.js";

export const router = Router();
// PostgreSQL notifications allow multiple backend instances to notify their clients.
const streams = new Set();
export function notifyClients() {
  for (const stream of streams) stream.write("event: changed\ndata: {}\n\n");
}
router.get("/events", (req, res) => {
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
router.get("/state", async (req, res) => {
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
