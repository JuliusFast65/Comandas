import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

let admin, pool, app, server, base;
const database=`comandas_test_${randomUUID().replaceAll('-','')}`;
const password='integration-only-password';
before(async()=>{
  assert.ok(process.env.DATABASE_URL,'DATABASE_URL is required');
  admin=new pg.Client({connectionString:process.env.DATABASE_URL}); await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  const url=new URL(process.env.DATABASE_URL); url.pathname=`/${database}`;
  process.env.DATABASE_URL=url.href;
  const init=spawnSync(process.execPath,['server/init.js'],{env:{...process.env,SEED_PASSWORD:password},encoding:'utf8'});
  assert.equal(init.status,0,init.stderr);
  ({pool}=await import('../server/db.js')); ({app}=await import('../server/app.js'));
  await start();
});
async function start() {
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  process.env.APP_ORIGIN=base;
}
async function stop() {
  const closed=new Promise(resolve=>server.close(resolve)); server.closeAllConnections(); await closed;
}
after(async()=>{
  if(server) await stop();
  if(pool) await pool.end();
  if(admin) { await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await admin.end(); }
});
function client() {
  let cookie='';
  return {
    get cookie(){return cookie;},
    async request(path,body,expected=200) {
      const response=await fetch(base+path,{headers:{Cookie:cookie,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});
      const set=response.headers.get('set-cookie'); if(set) cookie=set.split(';')[0];
      const data=await response.json(); assert.equal(response.status,expected,JSON.stringify(data)); return data;
    },
    login(role){return this.request('/api/login',{username:role,password});}
  };
}
test('flujo compartido, permisos, concurrencia e historial en PostgreSQL',async t=>{
  const mesero=client(),cocina=client(),bar=client(),caja=client(),other=client();
  let orderId, food, drink;
  async function order(c=mesero) { return (await c.request('/api/state')).orders.find(o=>o.id===orderId); }
  async function action(c,name,fields={},expected=200) {
    const current=await order(c);
    return c.request(`/api/orders/${orderId}/actions`,{action:name,version:current.version,...fields},expected);
  }
  await t.test('sesiones separadas y rechazo de accesos no autorizados',async()=>{
    await other.request('/api/state',undefined,401);
    await other.request('/api/login',{username:'mesero',password:'incorrecta'},401);
    await Promise.all([mesero.login('mesero'),cocina.login('cocina'),bar.login('bar'),caja.login('caja')]);
    assert.equal((await cocina.request('/api/me')).role,'cocina');
    await cocina.request('/api/orders',{tableNumber:1},403);
    await mesero.request('/api/history',undefined,403);
    const response=await fetch(base+'/api/orders',{method:'POST',headers:{Cookie:mesero.cookie,'Content-Type':'application/json',Origin:'https://another.example'},body:'{}'});
    assert.equal(response.status,403);
    const malformed=await fetch(base+'/api/orders',{method:'POST',headers:{Cookie:mesero.cookie,'Content-Type':'application/json'},body:'{'});
    assert.equal(malformed.status,400);
    const leaked=await fetch(base+'/server/schema.sql'); assert.equal(leaked.status,404);
  });
  await t.test('una sola orden por mesa y productos identificados individualmente',async()=>{
    const created=await mesero.request('/api/orders',{tableNumber:1},201); orderId=created.id;
    await mesero.request('/api/orders',{tableNumber:1},409);
    await mesero.request('/api/orders',{tableNumber:999},400);
    const state=await mesero.request('/api/state');
    food=state.products.find(p=>p.name==='Pizza'); drink=state.products.find(p=>p.name==='Agua');
    await action(mesero,'add',{productId:food.id,quantity:2,account:1,note:'Sin cebolla'});
    await action(mesero,'add',{productId:drink.id,quantity:1,account:2,note:''});
    assert.equal((await order(cocina)).items.length,2);
    await action(mesero,'add',{productId:food.id,quantity:-1,account:1,note:''},400);
  });
  await t.test('control de versiones y cambios concurrentes',async()=>{
    const current=await order();
    const body={action:'add',version:current.version,productId:food.id,quantity:1,account:1,note:'Otra porción'};
    const responses=await Promise.all([1,2].map(()=>fetch(`${base}/api/orders/${orderId}/actions`,{method:'POST',headers:{Cookie:mesero.cookie,'Content-Type':'application/json'},body:JSON.stringify(body)})));
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const after=await order(); assert.equal(after.items.length,3);
    const extra=after.items.find(i=>i.note==='Otra porción');
    await action(mesero,'remove',{itemId:extra.id});
    const pizza=(await order()).items.find(i=>i.area==='cocina');
    await action(mesero,'edit',{itemId:pizza.id,quantity:3,note:'Sin cebolla'});
  });
  await t.test('cuentas y privacidad de datos del cliente',async()=>{
    await action(mesero,'account',{account:1,name:'Ana',customer:{name:'Ana Prueba',identification:'123',email:'ana@example.com'}});
    assert.equal((await order(caja)).accounts.find(a=>a.number===1).customer.name,'Ana Prueba');
    assert.equal((await order(cocina)).accounts.find(a=>a.number===1).customer,undefined);
  });
  await t.test('notificaciones PostgreSQL y conexión de eventos',async()=>{
    const listener=await pool.connect(); await listener.query('LISTEN comandas_changed');
    const notified=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('No notification')),3000);
      listener.once('notification',n=>{clearTimeout(timer);resolve(n);});
    });
    try { await action(mesero,'send'); assert.equal((await notified).channel,'comandas_changed'); }
    finally { await listener.query('UNLISTEN comandas_changed'); listener.release(); }
    const abort=new AbortController();
    const response=await fetch(base+'/api/events',{headers:{Cookie:cocina.cookie},signal:abort.signal});
    assert.equal(response.headers.get('content-type'),'text/event-stream; charset=utf-8');
    const reader=response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value),/event: changed/);
    abort.abort();
  });
  await t.test('preparación por área y cierre solo al terminar ambos productos',async()=>{
    const current=await order();
    const pizza=current.items.find(i=>i.area==='cocina'),water=current.items.find(i=>i.area==='bar');
    await action(mesero,'ready',{itemId:pizza.id},403);
    await action(cocina,'ready',{itemId:water.id},403);
    await action(mesero,'remove',{itemId:pizza.id},409);
    await action(mesero,'bill');
    await action(caja,'close',{},409);
    await action(cocina,'ready',{itemId:pizza.id});
    await action(caja,'close',{},409);
    await action(bar,'ready',{itemId:water.id});
    await action(caja,'close');
    assert.equal(await order(),undefined);
    const history=await caja.request('/api/history');
    assert.equal(history[0].id,orderId); assert.equal(history[0].items.length,2);
    assert.equal(history[0].accounts.find(a=>a.number===1).customer.name,'Ana Prueba');
    assert.equal((await mesero.request('/api/orders',{tableNumber:1},201)).table_number,1);
  });
  await t.test('persistencia al reiniciar HTTP y sesiones independientes al salir',async()=>{
    await stop(); await start();
    assert.equal((await caja.request('/api/history'))[0].id,orderId);
    assert.equal((await cocina.request('/api/me')).role,'cocina');
    await mesero.request('/api/logout',{});
    await mesero.request('/api/me',undefined,401);
    assert.equal((await cocina.request('/api/me')).role,'cocina');
    assert.equal((await bar.request('/api/me')).role,'bar');
  });
});
