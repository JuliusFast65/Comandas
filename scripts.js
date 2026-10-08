let user=null, state={tables:[],products:[],orders:[]}, view='mesas', selected=null, events=null;
let busy=false, syncing=false, refreshAgain=false;
const roles={admin:'Administrador',mesero:'Mesero',cocina:'Cocina',bar:'Bar',caja:'Caja'};
const categoryNames={entradas:'Entradas',platos:'Platos fuertes',postres:'Postres',bebidas:'Bebidas',bebidasAlcoolicas:'Bebidas alcohólicas',adicionales:'Adicionales'};
const $=selector=>document.querySelector(selector);
function el(tag,content,attributes={}) {
  const node=document.createElement(tag);
  if(content!==null && content!==undefined) node.textContent=content;
  for(const [key,value] of Object.entries(attributes)) {
    if(key==='class') node.className=value;
    else node.setAttribute(key,value);
  }
  return node;
}
function button(label,fn,disabled=false) { const b=el('button',label); b.type='button'; b.disabled=disabled; b.addEventListener('click',fn); return b; }
function message(value,error=false) { $('#message').textContent=value; $('#message').className=error?'error':''; }
async function api(path,body) {
  const response=await fetch(`/api${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok) {
    if(response.status===401 && path!=='/login') logoutUI();
    throw new Error(data.error || 'No se pudo completar la operación.');
  }
  return data;
}
function logoutUI() {
  user=null; selected=null; state={tables:[],products:[],orders:[]};
  events?.close(); events=null;
  $('#identity').replaceChildren(); $('#login').hidden=false; $('#workspace').hidden=true;
  $('#content').replaceChildren();
}
async function refresh() {
  if(!user) return;
  if(syncing) { refreshAgain=true; return; }
  syncing=true;
  try {
    const next=await api('/state');
    if(!user) return;
    state=next;
    // Keep unsaved form entries intact when another client changes a different order.
    const focused=document.activeElement;
    const values=new Map([...$('#content').querySelectorAll('form[data-dirty="true"] input,form[data-dirty="true"] select,form[data-dirty="true"] textarea')].filter(n=>n.id).map(n=>[n.id,n.value]));
    const focusId=focused?.id;
    const openDetails=new Set([...$('#content').querySelectorAll('details[open]')].map(n=>n.id));
    render();
    for(const [id,value] of values) { const n=document.getElementById(id); if(n) { n.value=value; n.closest('form').dataset.dirty='true'; } }
    for(const id of openDetails) { const n=document.getElementById(id); if(n) n.open=true; }
    if(focusId) document.getElementById(focusId)?.focus();
  } catch(error) { message(error.message,true); }
  finally { syncing=false; if(refreshAgain) { refreshAgain=false; await refresh(); } }
}
async function run(fn) {
  if(busy) return;
  busy=true; $('#workspace').setAttribute('aria-busy','true');
  try { await fn(); message('Cambio guardado.'); }
  catch(error) { message(error.message,true); }
  finally { busy=false; $('#workspace').removeAttribute('aria-busy'); await refresh(); }
}
function action(order,name,fields={}) { return run(()=>api(`/orders/${order.id}/actions`,{action:name,version:order.version,...fields})); }
function signedIn() {
  $('#login').hidden=true; $('#workspace').hidden=false;
  $('#identity').replaceChildren(el('span',`${user.username} · ${roles[user.role]}`),button('Cerrar sesión',async()=>{
    try { await api('/logout',{}); logoutUI(); message('Sesión cerrada.'); } catch(e) { message(e.message,true); }
  }));
  view=user.role==='admin'||user.role==='mesero'?'mesas':user.role;
  events?.close(); events=new EventSource('/api/events');
  events.addEventListener('changed',refresh);
  events.onerror=()=>message('Reconectando con el servidor…',true);
  events.onopen=()=>{ message('Conectado.'); refresh(); };
  refresh();
}
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault(); const data=new FormData(event.target);
  const b=event.target.querySelector('button'); b.disabled=true;
  try { user=await api('/login',Object.fromEntries(data)); event.target.reset(); message('Sesión iniciada.'); signedIn(); }
  catch(error) { message(error.message,true); } finally { b.disabled=false; }
});
function orderTitle(o) { return o.table_number?`Mesa ${o.table_number} · Pedido ${o.number}`:`Para llevar · Pedido ${o.number}`; }
function statusLabel(o) { return o.status==='closed'?'Cerrado':o.status==='bill_requested'?'Cuenta solicitada':'Abierto'; }
function render() {
  if(!user) return;
  const nav=$('#navigation'); nav.replaceChildren();
  const areas=user.role==='admin'?['mesas','cocina','bar','caja','historial']:user.role==='caja'?['caja','historial']:user.role==='mesero'?['mesas']:[user.role];
  for(const area of areas) {
    const b=button(area==='mesas'?'Mesas y pedidos':area==='historial'?'Historial':roles[area],()=>{view=area;selected=null;render();});
    b.setAttribute('aria-pressed',String(view===area)); nav.append(b);
  }
  const content=$('#content'); content.replaceChildren();
  if(view==='historial') { renderHistory(content); return; }
  if(selected && view==='mesas') {
    const order=state.orders.find(o=>o.id===selected);
    if(order) { renderOrder(content,order); return; }
    selected=null;
  }
  if(view==='mesas') renderTables(content);
  if(view==='cocina'||view==='bar') renderPreparation(content);
  if(view==='caja') renderCash(content);
}
function renderTables(content) {
  content.append(el('h2','Mesas'));
  const grid=el('div',null,{class:'grid'});
  for(const table of state.tables) {
    const order=state.orders.find(o=>o.table_number===table.number);
    const b=button(`Mesa ${table.number} · ${order?statusLabel(order):'Libre'}`,()=>{
      if(order) { selected=order.id; render(); }
      else run(async()=>{const created=await api('/orders',{tableNumber:table.number}); selected=created.id;});
    });
    b.className=order?'occupied':'free'; grid.append(b);
  }
  content.append(grid,el('h2','Para llevar'),button('Nuevo pedido para llevar',()=>run(async()=>{const created=await api('/orders',{});selected=created.id;})));
  for(const order of state.orders.filter(o=>!o.table_number)) content.append(button(`${orderTitle(order)} · ${statusLabel(order)}`,()=>{selected=order.id;render();}));
}
function labeled(form,label,node) {
  const field=el('div');
  const l=el('label',label,{for:node.id}); field.append(l,node); form.append(field);
  node.addEventListener('input',()=>{form.dataset.dirty='true';});
  node.addEventListener('change',()=>{form.dataset.dirty='true';});
  return node;
}
function renderOrder(content,order) {
  content.append(button('Volver a mesas',()=>{selected=null;render();}),el('h2',orderTitle(order)),el('p',statusLabel(order)));
  const editable=order.status==='open';
  if(editable) {
    const form=el('form',null,{class:'panel',id:'add-form'});
    const product=el('select',null,{id:'product',name:'productId'});
    for(const [category,label] of Object.entries(categoryNames)) {
      const group=el('optgroup',null,{label});
      for(const p of state.products.filter(p=>p.category===category)) group.append(el('option',p.name,{value:p.id}));
      product.append(group);
    }
    labeled(form,'Producto',product);
    labeled(form,'Cantidad',el('input',null,{type:'number',id:'quantity',name:'quantity',value:'1',min:'1',max:'999',required:''}));
    labeled(form,'Cuenta',el('input',null,{type:'number',id:'account',name:'account',value:'1',min:'1',max:'99',required:''}));
    labeled(form,'Nota',el('input',null,{id:'note',name:'note',maxlength:'500'}));
    form.append(el('button','Agregar producto',{type:'submit'}));
    form.addEventListener('submit',e=>{
      e.preventDefault(); const d=Object.fromEntries(new FormData(form));
      action(order,'add',{...d,quantity:Number(d.quantity),account:Number(d.account)});
    }); content.append(form);
  }
  renderItems(content,order);
  content.append(button('Enviar pendientes a cocina/bar',()=>action(order,'send'),!editable||!order.items.some(i=>i.status==='draft')));
  content.append(button('Pedir cuenta',()=>action(order,'bill'),!editable||!order.items.length||order.items.some(i=>i.status==='draft')));
  renderAccounts(content,order);
}
function renderItems(content,order,area=null) {
  const list=el('ul',null,{class:'items'});
  for(const item of order.items.filter(i=>!area || (i.area===area && i.status!=='draft'))) {
    const li=el('li');
    li.append(el('strong',`${item.quantity} × ${item.product_name}`),el('span',`Cuenta ${item.account} · ${item.area} · ${{draft:'Sin enviar',preparing:'En preparación',ready:'Listo'}[item.status]}`));
    if(item.note) li.append(el('p',item.note));
    if(area && item.sent_at) li.append(el('small',`Enviado: ${new Date(item.sent_at).toLocaleTimeString()}`));
    if(area) li.append(button('Marcar listo',()=>action(order,'ready',{itemId:item.id}),item.status!=='preparing'));
    if(!area && item.status==='draft' && order.status==='open' && ['admin','mesero'].includes(user.role)) {
      li.append(button('Editar',()=>{
        const quantity=prompt('Cantidad:',String(item.quantity)); if(quantity===null) return;
        const note=prompt('Nota:',item.note); if(note===null) return;
        action(order,'edit',{itemId:item.id,quantity:Number(quantity),note});
      }),button('Quitar',()=>action(order,'remove',{itemId:item.id})));
    }
    list.append(li);
  }
  if(!list.children.length) list.append(el('li','No hay productos.'));
  content.append(list);
}
function renderAccounts(content,order) {
  for(const account of order.accounts.filter(a=>order.items.some(i=>i.account===a.number))) {
    const details=el('details',null,{id:`details-${order.id}-${account.number}`}); details.append(el('summary',`Cuenta ${account.number}${account.name?' · '+account.name:''} — datos del cliente`));
    const form=el('form',null,{class:'panel'});
    labeled(form,'Nombre de la cuenta',el('input',null,{id:`a-${order.id}-${account.number}-accountName`,name:'accountName',value:account.name,maxlength:'100'}));
    for(const [key,label] of Object.entries({identification:'Cédula / RUC',name:'Nombre del cliente',address:'Dirección',phone:'Teléfono',email:'Correo'})) labeled(form,label,el('input',null,{id:`a-${order.id}-${account.number}-${key}`,name:key,value:account.customer?.[key]||'',maxlength:'200',type:key==='email'?'email':'text'}));
    form.append(el('button','Guardar datos',{type:'submit'}));
    form.addEventListener('submit',e=>{
      e.preventDefault(); const {accountName,...customer}=Object.fromEntries(new FormData(form));
      action(order,'account',{account:account.number,name:accountName,customer});
    }); details.append(form); content.append(details);
  }
}
function renderPreparation(content) {
  content.append(el('h2',roles[view]));
  const orders=state.orders.filter(o=>o.items.some(i=>i.area===view && i.status!=='draft'));
  if(!orders.length) content.append(el('p','No hay pedidos enviados a esta área.'));
  for(const order of orders) {
    const card=el('section',null,{class:'panel'});
    card.append(el('h3',orderTitle(order))); renderItems(card,order,view); content.append(card);
  }
}
function renderCash(content) {
  content.append(el('h2','Cuentas solicitadas'));
  const orders=state.orders.filter(o=>o.status==='bill_requested');
  if(!orders.length) content.append(el('p','No hay cuentas pendientes.'));
  for(const order of orders) {
    const card=el('section',null,{class:'panel'}); card.append(el('h3',orderTitle(order)));
    renderItems(card,order); renderAccounts(card,order);
    card.append(button('Cerrar cuenta',()=>{
      if(confirm('¿Cerrar este pedido y liberar la mesa?')) action(order,'close');
    },order.items.some(i=>i.status!=='ready')));
    if(order.items.some(i=>i.status!=='ready')) card.append(el('p','Esperando que cocina y bar terminen los productos.'));
    content.append(card);
  }
}
async function renderHistory(content) {
  content.append(el('h2','Últimos 100 pedidos cerrados'));
  try {
    const orders=await api('/history'); if(view!=='historial'||!user) return;
    if(!orders.length) content.append(el('p','Todavía no hay pedidos cerrados.'));
    for(const order of orders) {
      const card=el('details'); card.append(el('summary',`${orderTitle(order)} · ${new Date(order.closed_at).toLocaleString()}`));
      renderItems(card,order);
      for(const a of order.accounts) card.append(el('p',`Cuenta ${a.number}: ${a.name || 'Sin nombre'} · ${a.customer.name || 'Sin datos del cliente'}`));
      content.append(card);
    }
  } catch(e) { message(e.message,true); }
}
// Polling repairs missed notifications and catches expired sessions after reconnects.
setInterval(refresh,15000);
api('/me').then(me=>{user=me;signedIn();}).catch(()=>logoutUI());
