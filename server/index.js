import { app, notifyClients } from './app.js';
import { pool } from './db.js';
await pool.query('SELECT version FROM schema_migrations WHERE version=1');
let listener;
let retry;
let stopping=false;
async function listenChanges() {
  try {
    listener=await pool.connect();
    listener.on('notification',notifyClients);
    listener.on('error',()=>{
      listener.release(true); listener=null;
      if(!stopping) retry=setTimeout(listenChanges,2000);
    });
    await listener.query('LISTEN comandas_changed');
  } catch(error) {
    console.error('Sincronización: reintentando conexión a PostgreSQL.');
    if(listener) { listener.release(true); listener=null; }
    if(!stopping) retry=setTimeout(listenChanges,2000);
  }
}
await listenChanges();
const server=app.listen(Number(process.env.PORT || 3000),process.env.HOST || '0.0.0.0',()=>console.log(`Comandas disponible en el puerto ${process.env.PORT || 3000}`));
async function stop() {
  stopping=true; clearTimeout(retry);
  server.close(); server.closeAllConnections();
  if(listener) listener.release(true);
  await pool.end();
}
process.on('SIGTERM',stop); process.on('SIGINT',stop);
