import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from './db.js';
import { hashPassword } from './password.js';
import { catalog } from './catalog.js';
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12 || password.startsWith('change-this')) {
  throw new Error('Define SEED_PASSWORD con al menos 12 caracteres y reemplaza el valor de ejemplo.');
}
try {
  await transaction(async db => {
    await db.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
    for (const role of ['admin','mesero','cocina','bar','caja']) {
      await db.query('INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,$3,$2) ON CONFLICT(username) DO NOTHING', [randomUUID(),role,hashPassword(password)]);
    }
    await db.query('INSERT INTO dining_tables(number) SELECT generate_series(1,9) ON CONFLICT DO NOTHING');
    for (const [category,names] of Object.entries(catalog)) {
      for (const name of names) await db.query('INSERT INTO products(id,name,category,area) VALUES($1,$2,$3,$4) ON CONFLICT(category,name) DO NOTHING', [randomUUID(),name,category,category.startsWith('bebidas') ? 'bar' : 'cocina']);
    }
  });
  console.log('Base inicializada. Usuarios: admin, mesero, cocina, bar, caja. Las cuentas existentes no se modificaron.');
} finally { await pool.end(); }
