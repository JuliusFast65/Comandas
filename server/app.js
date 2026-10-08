import express from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool, transaction } from './db.js';
import { hashPassword, verifyPassword, tokenHash } from './password.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));
app.use((req,res,next) => {
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','same-origin');
  res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (req.path.startsWith('/api')) res.set('Cache-Control','no-store');
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    if ((origin && origin !== expected) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({error:'Origen no permitido.'});
  }
  next();
});
const fail = (status,message) => { const e = new Error(message); e.status = status; throw e; };
const integer = (value,min,max) => Number.isInteger(value) && value >= min && value <= max;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value,max=500) => typeof value === 'string' && value.length <= max;
const sessionCookie = (token,maxAge=43200) => `comandas_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
const dummyHash = hashPassword(randomBytes(24).toString('hex'));
app.post('/api/login',rateLimit({windowMs:15*60*1000,limit:40,standardHeaders:'draft-8',legacyHeaders:false}),async (req,res) => {
  const {username,password} = req.body;
  if (!text(username,80) || !text(password,256)) fail(400,'Usuario y contraseña requeridos.');
  const {rows:[user]} = await pool.query('SELECT * FROM users WHERE username=$1 AND active=true',[username]);
  const valid = verifyPassword(password,user?.password_hash || dummyHash);
  if (!user || !valid) fail(401,'Usuario o contraseña incorrectos.');
  const token = randomBytes(32).toString('hex');
  await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
  await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",[tokenHash(token),user.id]);
  res.set('Set-Cookie',sessionCookie(token)).json({id:user.id,username:user.username,role:user.role});
});
app.use('/api',async (req,res,next) => {
  const cookie = req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('comandas_session='));
  const token = cookie?.slice('comandas_session='.length);
  if (!token) return res.status(401).json({error:'Inicia sesión.'});
  const {rows:[user]} = await pool.query('SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true',[tokenHash(token)]);
  if (!user) return res.status(401).json({error:'La sesión venció. Inicia sesión.'});
  req.user=user; req.sessionHash=tokenHash(token); next();
});
app.get('/api/me',(req,res)=>res.json(req.user));
app.post('/api/logout',async(req,res)=>{
  await pool.query('DELETE FROM sessions WHERE token_hash=$1',[req.sessionHash]);
  res.set('Set-Cookie',sessionCookie('',0)).json({ok:true});
});

// PostgreSQL notifications allow multiple backend instances to notify their clients.
const streams = new Set();
export function notifyClients() { for (const stream of streams) stream.write('event: changed\ndata: {}\n\n'); }
app.get('/api/events',(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.flushHeaders(); streams.add(res);
  res.write('event: changed\ndata: {}\n\n');
  const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),20000);
  const expire=setTimeout(()=>res.end(),12*60*60*1000);
  req.on('close',()=>{ clearInterval(heartbeat); clearTimeout(expire); streams.delete(res); });
});
app.get('/api/state',async(req,res)=>{
  const state=await transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables=(await db.query('SELECT number FROM dining_tables ORDER BY number')).rows;
    const products=(await db.query('SELECT * FROM products ORDER BY category,name')).rows;
    const orders=(await db.query("SELECT * FROM orders WHERE status<>'closed' ORDER BY number")).rows;
    const items=(await db.query("SELECT i.* FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status<>'closed' ORDER BY i.sent_at NULLS FIRST,i.id")).rows;
    const accounts=(await db.query("SELECT a.* FROM order_accounts a JOIN orders o ON o.id=a.order_id WHERE o.status<>'closed'")).rows;
    const maySeeCustomer=['admin','mesero','caja'].includes(req.user.role);
    return {tables,products,orders:orders.map(o=>({...o,items:items.filter(i=>i.order_id===o.id),accounts:accounts.filter(a=>a.order_id===o.id).map(a=>maySeeCustomer?a:{number:a.number,name:a.name})}))};
  });
  res.json(state);
});
function allow(user,roles) { if(user.role!=='admin' && !roles.includes(user.role)) fail(403,'Tu rol no permite esta operación.'); }
async function event(db,order,user,action) {
  await db.query('UPDATE orders SET version=version+1 WHERE id=$1',[order]);
  await db.query('INSERT INTO order_events(order_id,user_id,action) VALUES($1,$2,$3)',[order,user,action]);
  await db.query("SELECT pg_notify('comandas_changed','')");
}
app.post('/api/orders',async(req,res)=>{
  allow(req.user,['mesero']);
  const table=req.body.tableNumber ?? null;
  if(table!==null && !integer(table,1,999)) fail(400,'Mesa inválida.');
  const order=await transaction(async db=>{
    const id=randomUUID();
    const {rows:[order]}=await db.query('INSERT INTO orders(id,table_number,created_by) VALUES($1,$2,$3) RETURNING *',[id,table,req.user.id]);
    await event(db,id,req.user.id,'created'); return order;
  });
  res.status(201).json(order);
});
app.post('/api/orders/:id/actions',async(req,res)=>{
  if(!uuid(req.params.id)) fail(400,'Pedido inválido.');
  const {action,version}=req.body;
  const roleActions={add:['mesero'],edit:['mesero'],remove:['mesero'],account:['mesero','caja'],send:['mesero'],ready:['cocina','bar'],bill:['mesero','caja'],close:['caja']};
  if(!Object.hasOwn(roleActions,action)) fail(400,'Acción inválida.');
  allow(req.user,roleActions[action]);
  if(!integer(version,0,2147483647)) fail(400,'Versión requerida.');
  await transaction(async db=>{
    const {rows:[order]}=await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!order) fail(404,'Pedido no encontrado.');
    if(order.status==='closed') fail(409,'El pedido ya está cerrado.');
    if(order.version!==version) fail(409,'Otro usuario modificó el pedido. Se actualizarán los datos; vuelve a intentar.');
    const id=order.id, b=req.body;
    if(['add','edit','remove','send'].includes(action) && order.status!=='open') fail(409,'La cuenta ya fue solicitada.');
    if(action==='add') {
      if(!uuid(b.productId) || !integer(b.quantity,1,999) || !integer(b.account,1,99) || !text(b.note)) fail(400,'Producto, cantidad, cuenta o nota inválidos.');
      const {rows:[p]}=await db.query('SELECT * FROM products WHERE id=$1',[b.productId]);
      if(!p) fail(404,'Producto no encontrado.');
      await db.query('INSERT INTO order_accounts(order_id,number) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,b.account]);
      await db.query('INSERT INTO order_items(id,order_id,product_id,product_name,area,quantity,account,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),id,p.id,p.name,p.area,b.quantity,b.account,b.note]);
    }
    if(['edit','remove','ready'].includes(action)) {
      if(!uuid(b.itemId)) fail(400,'Ítem inválido.');
      const {rows:[item]}=await db.query('SELECT * FROM order_items WHERE id=$1 AND order_id=$2',[b.itemId,id]);
      if(!item) fail(404,'Ítem no encontrado.');
      if(action==='ready') {
        if(req.user.role!=='admin' && req.user.role!==item.area) fail(403,'El ítem pertenece a otra área.');
        if(item.status!=='preparing') fail(409,'El ítem no está en preparación.');
        await db.query("UPDATE order_items SET status='ready',ready_at=now() WHERE id=$1",[item.id]);
      } else {
        if(item.status!=='draft') fail(409,'Solo puedes editar productos que aún no se enviaron.');
        if(action==='remove') await db.query('DELETE FROM order_items WHERE id=$1',[item.id]);
        else {
          if(!integer(b.quantity,1,999) || !text(b.note)) fail(400,'Cantidad o nota inválidas.');
          await db.query('UPDATE order_items SET quantity=$1,note=$2 WHERE id=$3',[b.quantity,b.note,item.id]);
        }
      }
    }
    if(action==='account') {
      if(!integer(b.account,1,99) || !text(b.name,100)) fail(400,'Cuenta inválida.');
      const customer=b.customer ?? {};
      if(typeof customer!=='object' || customer===null || Array.isArray(customer) || Object.keys(customer).some(k=>!['identification','name','address','phone','email'].includes(k)) || Object.values(customer).some(v=>!text(v,200))) fail(400,'Datos del cliente inválidos.');
      await db.query('INSERT INTO order_accounts(order_id,number,name,customer) VALUES($1,$2,$3,$4) ON CONFLICT(order_id,number) DO UPDATE SET name=$3,customer=$4',[id,b.account,b.name,customer]);
    }
    if(action==='send') {
      const sent=await db.query("UPDATE order_items SET status='preparing',sent_at=now() WHERE order_id=$1 AND status='draft'",[id]);
      if(!sent.rowCount) fail(409,'No hay productos pendientes de enviar.');
    }
    if(action==='bill') {
      const {rows:[counts]}=await db.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE status='draft')::int AS draft FROM order_items WHERE order_id=$1",[id]);
      if(!counts.total || counts.draft) fail(409,'Envía los productos antes de pedir la cuenta.');
      await db.query("UPDATE orders SET status='bill_requested' WHERE id=$1",[id]);
    }
    if(action==='close') {
      if(order.status!=='bill_requested') fail(409,'Primero solicita la cuenta.');
      const {rows:[counts]}=await db.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE status<>'ready')::int AS pending FROM order_items WHERE order_id=$1",[id]);
      if(!counts.total || counts.pending) fail(409,'Hay productos pendientes de preparación.');
      await db.query("UPDATE orders SET status='closed',closed_at=now() WHERE id=$1",[id]);
    }
    await event(db,id,req.user.id,action);
  });
  res.json({ok:true});
});
app.get('/api/history',async(req,res)=>{
  allow(req.user,['caja']);
  const {rows}=await pool.query("SELECT o.*,COALESCE((SELECT jsonb_agg(i) FROM order_items i WHERE i.order_id=o.id),'[]'::jsonb) AS items,COALESCE((SELECT jsonb_agg(a) FROM order_accounts a WHERE a.order_id=o.id),'[]'::jsonb) AS accounts FROM orders o WHERE status='closed' ORDER BY closed_at DESC LIMIT 100");
  res.json(rows);
});
const root=fileURLToPath(new URL('../',import.meta.url));
for(const file of ['index.html','scripts.js','styles.css','app.css']) {
  app.get(file==='index.html'?'/':`/${file}`,(req,res)=>res.sendFile(file,{root}));
}
app.use('/api',(req,res)=>res.status(404).json({error:'Ruta no encontrada.'}));
app.use((error,req,res,next)=>{
  if(error.code==='23505') return res.status(409).json({error:'Esta mesa ya tiene un pedido activo. Actualiza la lista.'});
  if(error.code==='23503') return res.status(400).json({error:'La mesa o el registro no existe.'});
  const status=error.status || 500;
  if(status>=500) console.error('Error del servidor:',error.code || error.message);
  res.status(status).json({error:status>=500?'No se pudo completar la operación.':error.message});
});
