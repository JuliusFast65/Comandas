// Health, sign-in, the session check that protects every later route, and the own account.
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { pool, transaction } from "../db.js";
import { hashPassword, verifyPassword, tokenHash } from "../password.js";
import {
  fail,
  text,
  sessionCookie,
  dummyHash,
  newPassword,
  passwordRule,
  audit,
  attemptLimit,
  assignedStations,
} from "../shared.js";

export const router = Router();
// For the service supervisor and monitoring: answers without a session and checks the database.
router.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "Base de datos no disponible." });
  }
});
router.post(
  "/login",
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
router.use(async (req, res, next) => {
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
router.get("/me", (req, res) => res.json(req.user));
router.post(
  "/password",
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

router.get("/customers", async (req, res) => {
  if (!["caja", "admin"].includes(req.user.role)) fail(403, "Acceso solo para Caja y administrador.");
  const identification = req.query.identification;
  if (!text(identification, 200) || !identification.trim()) fail(400, "Identificación requerida.");
  const { rows: [account] } = await pool.query(
    "SELECT a.customer FROM order_accounts a JOIN orders o ON o.id=a.order_id WHERE btrim(a.customer->>'identification')=$1 AND btrim(COALESCE(a.customer->>'name',''))<>'' ORDER BY o.number DESC,a.number DESC LIMIT 1",
    [identification.trim()],
  );
  res.json({ customer: account?.customer ?? null });
});
router.post("/logout", async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
    req.sessionHash,
  ]);
  res.set("Set-Cookie", sessionCookie("", 0)).json({ ok: true });
});
