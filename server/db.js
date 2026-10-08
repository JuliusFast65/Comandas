import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL en .env');
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
