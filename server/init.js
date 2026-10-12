import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db.js";
import { hashPassword } from "./password.js";
import { catalog } from "./catalog.js";
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12 || password.startsWith("change-this")) {
  throw new Error(
    "Define SEED_PASSWORD con al menos 12 caracteres y reemplaza el valor de ejemplo.",
  );
}
try {
  await transaction(async (db) => {
    await db.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    for (const role of [
      "admin",
      "supervisor",
      "mesero",
      "caja",
      "auditor",
    ]) {
      await db.query(
        "INSERT INTO users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,$2,true) ON CONFLICT(username) DO NOTHING",
        [randomUUID(), role, hashPassword(password)],
      );
    }
    for (const station of ["cocina", "bar"]) {
      const { rows: [user] } = await db.query(
        "INSERT INTO users(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,'estacion',true) ON CONFLICT(username) DO NOTHING RETURNING id",
        [randomUUID(), station, hashPassword(password)],
      );
      // Seed assignments only for new accounts; preserve later changes on reinitialization.
      if (user) await db.query(
        "INSERT INTO user_stations(user_id,station_code) VALUES($1,$2)",
        [user.id, station],
      );
    }
    for (const [username, name] of [
      ["mesero", "Mesero"],
      ["mesero1", "Mesero 1"],
      ["mesero2", "Mesero 2"],
    ]) {
      const {
        rows: [waiter],
      } = await db.query(
        "INSERT INTO waiters(id,name) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id",
        [randomUUID(), name],
      );
      await db.query(
        "INSERT INTO users(id,username,password_hash,role,waiter_id,must_change_password) VALUES($1,$2,$3,'mesero',$4,true) ON CONFLICT(username) DO UPDATE SET waiter_id=COALESCE(users.waiter_id,EXCLUDED.waiter_id)",
        [randomUUID(), username, hashPassword(password), waiter.id],
      );
    }
    await db.query(
      "INSERT INTO dining_tables(number) SELECT generate_series(1,9) ON CONFLICT DO NOTHING",
    );
    for (const [category, names] of Object.entries(catalog)) {
      for (const name of names)
        await db.query(
          "INSERT INTO products(id,name,category,area) VALUES($1,$2,$3,$4) ON CONFLICT(category,name) DO NOTHING",
          [
            randomUUID(),
            name,
            category,
            category.startsWith("bebidas") ? "bar" : "cocina",
          ],
        );
    }
  });
  console.log(
    "Base inicializada. Usuarios: admin, supervisor, mesero, mesero1, mesero2, cocina, bar, caja, auditor. Se conservan los pedidos y las contraseñas existentes.",
  );
} finally {
  await pool.end();
}
