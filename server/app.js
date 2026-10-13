import express from "express";
import { fileURLToPath } from "node:url";
import { router as session } from "./routes/session.js";
import { router as state } from "./routes/state.js";
import { router as orders } from "./routes/orders.js";
import { router as records } from "./routes/records.js";
import { router as administration } from "./routes/administration.js";
export { notifyClients } from "./routes/state.js";

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
// Order matters: the session router answers health and sign-in, then requires a session for the rest.
for (const router of [session, state, orders, records, administration]) app.use("/api", router);
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
