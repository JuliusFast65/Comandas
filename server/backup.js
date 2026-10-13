// Writes a compressed PostgreSQL dump to backups/ and keeps the most recent ones.
// Uses pg_dump from the PATH or, when it is not installed, the Compose database container.
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL en .env");
const directory = process.env.BACKUP_DIR || "backups",
  keep = Math.max(1, Number(process.env.BACKUP_KEEP) || 30),
  url = new URL(process.env.DATABASE_URL),
  file = join(directory, `comandas-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
mkdirSync(directory, { recursive: true });
const output = openSync(file, "w"),
  stdio = ["ignore", output, "pipe"];
// The password travels in the environment, not in the command line.
let result = spawnSync("pg_dump", ["-Fc"], {
  stdio,
  env: {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
  },
});
if (result.error?.code === "ENOENT")
  result = spawnSync(
    "docker",
    ["compose", "exec", "-T", "db", "sh", "-c", 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
    { stdio },
  );
closeSync(output);
if (result.status !== 0 || !statSync(file).size) {
  unlinkSync(file);
  console.error("No se pudo crear el respaldo:", result.error?.message || String(result.stderr || "").trim());
  process.exit(1);
}
const previous = readdirSync(directory)
  .filter((name) => /^comandas-.*\.dump$/.test(name))
  .sort()
  .reverse()
  .slice(keep);
for (const name of previous) unlinkSync(join(directory, name));
console.log(`Respaldo creado: ${file} (${statSync(file).size} bytes). Se conservan los últimos ${keep}.`);
