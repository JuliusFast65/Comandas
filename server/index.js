import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { app, notifyClients } from "./app.js";
import { pool } from "./db.js";
const { rowCount: migrated } = await pool.query(
  "SELECT version FROM schema_migrations WHERE version=11",
);
if (!migrated)
  throw new Error(
    "Ejecuta npm run db:init para actualizar la base sin eliminar los pedidos.",
  );
let listener;
let retry;
let stopping = false;
async function listenChanges() {
  try {
    listener = await pool.connect();
    listener.on("notification", notifyClients);
    listener.on("error", () => {
      listener.release(true);
      listener = null;
      if (!stopping) retry = setTimeout(listenChanges, 2000);
    });
    await listener.query("LISTEN comandas_changed");
  } catch (error) {
    console.error("Sincronización: reintentando conexión a PostgreSQL.");
    if (listener) {
      listener.release(true);
      listener = null;
    }
    if (!stopping) retry = setTimeout(listenChanges, 2000);
  }
}
await listenChanges();
// With a certificate the server speaks HTTPS itself, so passwords and sessions are encrypted
// on the local network without a reverse proxy.
const tls = process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE;
if (tls && process.env.COOKIE_SECURE !== "true")
  console.warn("HTTPS activo: define COOKIE_SECURE=true para que la sesión solo viaje cifrada.");
const server = (
  tls
    ? createServer(
        { cert: readFileSync(process.env.TLS_CERT_FILE), key: readFileSync(process.env.TLS_KEY_FILE) },
        app,
      )
    : app
).listen(Number(process.env.PORT || 3000), process.env.HOST || "0.0.0.0", () =>
  console.log(`Comandas disponible en el puerto ${process.env.PORT || 3000} (${tls ? "HTTPS" : "HTTP"})`),
);
server.on("error", async (error) => {
  console.error(`No se pudo iniciar Comandas: ${error.code || error.message}`);
  await stop();
  process.exitCode = 1;
});
async function stop() {
  stopping = true;
  clearTimeout(retry);
  server.close();
  server.closeAllConnections();
  if (listener) {
    listener.release(true);
    listener = null;
  }
  await pool.end();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
