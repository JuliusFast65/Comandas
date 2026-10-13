// Applies, in order, the numbered files of server/migrations that the database does not have yet.
import { readdir, readFile } from "node:fs/promises";

const directory = new URL("./migrations/", import.meta.url);
async function files() {
  return (await readdir(directory))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({ name, version: Number(name.slice(0, 3)) }));
}
export async function latestVersion() {
  return (await files()).at(-1).version;
}
// Run inside a transaction: a failed migration leaves the database as it was.
export async function migrate(db) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  // Two servers initializing at once apply each migration only once.
  await db.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
  const applied = new Set(
    (await db.query("SELECT version FROM schema_migrations")).rows.map((row) => row.version),
  );
  const done = [];
  for (const { name, version } of await files()) {
    if (applied.has(version)) continue;
    await db.query(await readFile(new URL(name, directory), "utf8"));
    await db.query("INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING", [version]);
    done.push(name);
  }
  return done;
}
