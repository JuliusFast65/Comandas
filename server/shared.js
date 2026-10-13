// Validation, permissions and database helpers shared by the route modules.
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { pool, transaction } from "./db.js";
import { hashPassword } from "./password.js";

export const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
export const integer = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max;
export const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const text = (value, max = 500) =>
  typeof value === "string" && value.length <= max;
export const sessionCookie = (token, maxAge = 43200) =>
  `comandas_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`;
export const dummyHash = hashPassword(randomBytes(24).toString("hex"));
export const newPassword = (value) => text(value, 256) && value.length >= 8;
export const passwordRule = "La contraseña debe tener entre 8 y 256 caracteres.";
export const userRoles = ["admin", "supervisor", "mesero", "estacion", "caja", "auditor"];
// Administrative log: accounts, access and configuration. Order changes go to order_events.
export async function audit(db, userId, action, details = {}) {
  await db.query("INSERT INTO audit_events(user_id,action,details) VALUES($1,$2,$3)", [
    userId,
    action,
    details,
  ]);
}
// Devices behind one address share the limit, so correct sign-ins do not consume it.
export const attemptLimit = (skipSuccessfulRequests) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests,
    message: { error: "Demasiados intentos. Espera unos minutos y vuelve a intentar." },
  });
export async function assignedStations(userId, db = pool) {
  return (await db.query(
    "SELECT s.code FROM user_stations us JOIN stations s ON s.code=us.station_code WHERE us.user_id=$1 AND s.active=true ORDER BY s.code",
    [userId],
  )).rows.map((s) => s.code);
}
export function allow(user, roles) {
  if (user.role !== "admin" && !roles.includes(user.role))
    fail(403, "Tu rol no permite esta operación.");
}
export function ownOrder(user, order) {
  if (
    user.role === "mesero" &&
    order.waiter_id &&
    order.waiter_id !== user.waiter_id
  )
    fail(403, "Esta mesa pertenece a otro mesero.");
}
export async function waiterLabel(db, id) {
  if (!id) return null;
  return (await db.query("SELECT name FROM waiters WHERE id=$1", [id])).rows[0]?.name ?? null;
}
// A shared configuration version prevents overwriting another administrator's changes.
export async function changeConfiguration(version, fn, record) {
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
export const cleanName = (value, max) => (text(value, max) && value.trim() ? value.trim() : null);
export const price = (value) => integer(value, 0, 10000000);
