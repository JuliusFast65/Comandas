// Closed operations, the log of each order and the audit view.
import { Router } from "express";
import { pool } from "../db.js";
import { fail, uuid, allow } from "../shared.js";

export const router = Router();
router.get("/history", async (req, res) => {
  allow(req.user, ["caja", "auditor", "supervisor"]);
  const { rows } = await pool.query(
    "SELECT o.*,COALESCE((SELECT jsonb_agg(i) FROM order_items i WHERE i.order_id=o.id),'[]'::jsonb) AS items,COALESCE((SELECT jsonb_agg(a ORDER BY a.number) FROM order_accounts a WHERE a.order_id=o.id),'[]'::jsonb) AS accounts,COALESCE((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('username',u.username) ORDER BY v.id) FROM order_item_voids v JOIN users u ON u.id=v.voided_by WHERE v.order_id=o.id),'[]'::jsonb) AS voids,COALESCE((SELECT jsonb_agg(jsonb_build_object('action',e.action,'details',e.details,'created_at',e.created_at,'username',u.username) ORDER BY e.id) FROM order_events e JOIN users u ON u.id=e.user_id WHERE e.order_id=o.id),'[]'::jsonb) AS events FROM orders o WHERE status='closed' ORDER BY closed_at DESC LIMIT 100",
  );
  res.json(rows);
});
router.get("/orders/:id/events", async (req, res) => {
  allow(req.user, ["supervisor", "caja", "auditor"]);
  if (!uuid(req.params.id)) fail(400, "Pedido inválido.");
  const { rows } = await pool.query(
    "SELECT e.action,e.details,e.created_at,u.username FROM order_events e JOIN users u ON u.id=e.user_id WHERE e.order_id=$1 ORDER BY e.id",
    [req.params.id],
  );
  res.json(rows);
});
// Latest changes of orders and administration, newest first.
router.get("/audit", async (req, res) => {
  allow(req.user, ["auditor"]);
  const { rows } = await pool.query(
    "SELECT * FROM (SELECT e.created_at,u.username,e.action,e.details,'pedido' AS scope,o.number::int AS order_number,o.table_number FROM order_events e JOIN users u ON u.id=e.user_id JOIN orders o ON o.id=e.order_id UNION ALL SELECT a.created_at,u.username,a.action,a.details,'administracion',NULL,NULL FROM audit_events a JOIN users u ON u.id=a.user_id) events WHERE $1::text IS NULL OR scope=$1 OR ($1='correcciones' AND action IN ('void','note','move','transfer','remove','edit','assign','discount')) ORDER BY created_at DESC LIMIT 300",
    [["pedido", "administracion", "correcciones"].includes(req.query.scope) ? req.query.scope : null],
  );
  res.json(rows);
});
