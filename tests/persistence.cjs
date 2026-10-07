const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');
const key = 'comandas.estado.v1';

async function open(saved, unavailable = false, acceso = null) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
        url: 'https://example.test/Comandas/', runScripts: 'dangerously', virtualConsole
    });
    const w = dom.window;
    w.alert = () => { throw new Error('Unexpected native alert'); };
    // jsdom does not implement the browser dialog API.
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
        this.dispatchEvent(new w.Event('close'));
    };
    if (saved) w.localStorage.setItem(key, saved);
    if (acceso) w.localStorage.setItem('comandas.ultimoAcceso.v1', acceso);
    if (unavailable) Object.defineProperty(w, 'localStorage', { get() { throw new Error('Unavailable'); } });
    w.eval(fs.readFileSync(path.join(root, 'scripts.js'), 'utf8') + '\nwindow.inicioRestaurado = () => tiemposDePreparacion[0]?.inicio;');
    await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    assert.deepEqual(errors, []);
    return w;
}

test('draft quantities, notes and account names survive a new page', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.agregarProducto('Pizza');
    w.document.getElementById('nombre-cuenta').value = 'Familia';
    w.actualizarNombreCuenta();
    w.abrirModalNota(0);
    w.document.getElementById('nota-texto').value = 'Sin cebolla';
    w.guardarNota();
    const saved = w.localStorage.getItem(key);
    w.close();
    const restored = await open(saved);
    restored.seleccionarMesa(1);
    const text = restored.document.getElementById('orden-list').textContent;
    assert.match(text, /Pizza/);
    assert.match(text, /2/);
    restored.abrirModalNota(0);
    assert.equal(restored.document.getElementById('nota-texto').value, 'Sin cebolla');
    assert.equal(JSON.parse(saved).mesas[0].nombresCuentas[1], 'Familia');
    restored.close();
});

test('sent orders, takeaway numbering and timers survive without resending', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.agregarProducto('Coca-Cola');
    w.enviarCocina();
    w.crearParaLlevar();
    const saved = w.localStorage.getItem(key);
    w.close();
    const restored = await open(saved);
    assert.match(restored.document.getElementById('cocina-list').textContent, /Pizza/);
    assert.match(restored.document.getElementById('bar-list').textContent, /Coca-Cola/);
    restored.seleccionarMesa(1);
    restored.enviarCocina();
    restored.crearParaLlevar();
    const state = JSON.parse(restored.localStorage.getItem(key));
    assert.equal(state.mesas[0].ordenes.filter(g => g.estado === 'en cocina').length, 1);
    assert.equal(state.mesas[0].ordenes.filter(g => g.estado === 'en bar').length, 1);
    assert.deepEqual(state.paraLlevarOrdenes.map(p => p.numero), [1, 2]);
    assert.ok(Number.isFinite(restored.inicioRestaurado().getTime()));
    restored.close();
});

test('corrupt data is preserved and application remains usable', async () => {
    const w = await open('{invalid');
    w.crearParaLlevar();
    assert.equal(w.localStorage.getItem(key), '{invalid');
    assert.match(w.document.getElementById('estado-guardado').textContent, /conservaron/);
    w.close();
});

test('unavailable storage does not break initialization or ordering', async () => {
    const w = await open(null, true);
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    assert.match(w.document.getElementById('orden-list').textContent, /Pizza/);
    w.close();
});

test('pending counters track units, takeaway, completion, reopening and reload', async () => {
    const w = await open();
    const count = (window, area) => window.document.getElementById(`pendientes-${area}`).textContent;
    assert.equal(count(w, 'cocina'), '· 0 pendientes');
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.agregarProducto('Pizza');
    w.agregarProducto('Coca-Cola');
    assert.equal(count(w, 'cocina'), '· 0 pendientes');
    w.enviarCocina();
    assert.equal(count(w, 'cocina'), '· 2 pendientes');
    assert.equal(count(w, 'bar'), '· 1 pendiente');
    w.crearParaLlevar();
    w.seleccionarOrdenParaLlevar(1);
    w.agregarProducto('Pasta');
    w.enviarCocina();
    assert.equal(count(w, 'cocina'), '· 3 pendientes');
    w.seleccionarMesa(1);
    w.document.querySelector('#cocina-list input[type=checkbox]').click();
    assert.equal(count(w, 'cocina'), '· 1 pendiente');
    assert.equal(count(w, 'bar'), '· 1 pendiente');
    const saved = w.localStorage.getItem(key);
    w.close();
    const restored = await open(saved);
    assert.equal(count(restored, 'cocina'), '· 1 pendiente');
    assert.equal(count(restored, 'bar'), '· 1 pendiente');
    restored.document.querySelector('#cocina-list input[type=checkbox]').click();
    assert.equal(count(restored, 'cocina'), '· 3 pendientes');
    restored.document.querySelector('#bar-list input[type=checkbox]').click();
    assert.equal(count(restored, 'bar'), '· 0 pendientes');
    restored.close();
});

test('styled notices show validation and success with accessible focus', async () => {
    const w = await open();
    const dialog = w.document.getElementById('aviso-dialogo');
    const user = w.document.getElementById('usuario');
    user.focus();
    w.iniciarSesion();
    assert.ok(dialog.open);
    assert.equal(dialog.dataset.tipo, 'aviso');
    assert.match(w.document.getElementById('aviso-mensaje').textContent, /usuario y la contraseña/);
    assert.equal(w.document.activeElement.id, 'aviso-aceptar');
    dialog.close();
    assert.equal(w.document.activeElement, user);
    user.value = 'incorrecto';
    w.document.getElementById('contrasena').value = 'incorrecto';
    w.iniciarSesion();
    assert.match(w.document.getElementById('aviso-titulo').textContent, /Revisa/);
    dialog.close();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.enviarCocina();
    assert.ok(dialog.open);
    assert.equal(dialog.dataset.tipo, 'exito');
    assert.equal(w.document.getElementById('aviso-titulo').textContent, 'Orden enviada');
    assert.equal(w.document.querySelector('.screen.active').id, 'seleccion-mesas-screen');
    dialog.close();
    assert.ok(w.document.querySelector('.screen.active').contains(w.document.activeElement));
    w.confirmarFacturacion();
    assert.equal(dialog.dataset.tipo, 'aviso');
    assert.equal(w.document.getElementById('aviso-titulo').textContent, 'Faltan datos del cliente');
    w.close();
});

test('partial pickup, table priority and additional rounds persist across reload', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    for (let i = 0; i < 3; i++) w.agregarProducto('Pizza');
    w.agregarProducto('Coca-Cola');
    w.enviarCocina();
    const table = () => w.document.querySelector('#mesas .mesa');
    assert.ok(table().classList.contains('en-preparacion'));
    w.document.querySelector('#cocina-list input[type=checkbox]').click();
    assert.ok(table().classList.contains('por-retirar'));
    const quantity = w.document.querySelector('#cocina-list .pickup-controls input');
    quantity.value = '2';
    w.document.querySelector('#cocina-list .pickup-controls button').click();
    assert.match(table().textContent, /1 por retirar · 1 en preparación/);
    assert.match(w.document.getElementById('cocina-list').textContent, /2 retirados/);
    w.seleccionarMesa(1);
    w.document.getElementById('retirar-listos-mesa').click();
    assert.ok(table().classList.contains('en-preparacion'));
    w.document.querySelector('#bar-list input[type=checkbox]').click();
    w.document.getElementById('retirar-listos-mesa').click();
    assert.ok(table().classList.contains('retirada'));
    w.agregarProducto('Pasta');
    w.enviarCocina();
    assert.ok(table().classList.contains('en-preparacion'));
    assert.match(table().textContent, /Adicionales en preparación/);
    const checks = w.document.querySelectorAll('#cocina-list input[type=checkbox]');
    checks[checks.length - 1].click();
    assert.ok(table().classList.contains('por-retirar'));
    assert.match(table().textContent, /Adicionales listos/);
    const saved = w.localStorage.getItem(key);
    w.close();
    const restored = await open(saved);
    assert.match(restored.document.querySelector('#mesas .mesa').textContent, /Adicionales listos/);
    assert.equal(restored.document.getElementById('listos-cocina').textContent, '· 1 por retirar');
    restored.retirarTodoListo('mesa', 1);
    assert.ok(restored.document.querySelector('#mesas .mesa').classList.contains('retirada'));
    restored.close();
});

test('pickup and preparation isolate accounts and takeaway with matching table number', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.document.getElementById('cuentas').value = '2';
    w.agregarProducto('Pizza');
    w.enviarCocina();
    w.crearParaLlevar();
    w.seleccionarOrdenParaLlevar(1);
    w.agregarProducto('Pizza');
    w.enviarCocina();
    w.document.querySelector('#cocina-list input[type=checkbox]').click();
    const data = () => JSON.parse(w.localStorage.getItem(key));
    assert.equal(data().mesas[0].ordenes[1].items[0].enCocina, 'terminado');
    assert.equal(data().mesas[0].ordenes[1].items[1].enCocina, true);
    assert.equal(data().paraLlevarOrdenes[0].ordenes[1].items[0].enCocina, true);
    w.retirarTodoListo('mesa', 1);
    assert.equal(data().mesas[0].ordenes[1].items[0].retirados, 1);
    assert.equal(data().mesas[0].ordenes[1].items[1].retirados, 0);
    assert.equal(data().paraLlevarOrdenes[0].ordenes[1].items[0].retirados, 0);
    w.close();
});

test('invalid or unprepared pickup cannot mutate quantities; old data stays compatible', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.enviarCocina();
    w.retirarProducto('mesa', 1, 1, 0, 1);
    const state = () => JSON.parse(w.localStorage.getItem(key));
    assert.equal(state().mesas[0].ordenes[1].items[0].retirados, 0);
    w.marcarPreparado('mesa', 1, 1, 0, true);
    for (const amount of [0, -1, 2, 0.5, NaN]) w.retirarProducto('mesa', 1, 1, 0, amount);
    assert.equal(state().mesas[0].ordenes[1].items[0].retirados, 0);
    const old = state();
    delete old.mesas[0].ordenes[1].items[0].retirados;
    delete old.mesas[0].ordenes[1].items[0].adicional;
    w.close();
    const restored = await open(JSON.stringify(old));
    assert.equal(restored.document.getElementById('listos-cocina').textContent, '· 1 por retirar');
    restored.retirarTodoListo('mesa', 1);
    assert.ok(restored.document.querySelector('#mesas .mesa').classList.contains('retirada'));
    restored.close();
});

test('Enter logs in and only successful credentials are restored without auto-login', async () => {
    const w = await open();
    w.document.getElementById('usuario').value = 'admin';
    const password = w.document.getElementById('contrasena');
    password.value = '1234';
    password.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(w.document.querySelector('.screen.active').id, 'seleccion-mesas-screen');
    const saved = w.localStorage.getItem('comandas.ultimoAcceso.v1');
    assert.deepEqual(JSON.parse(saved), { usuario: 'admin', contrasena: '1234' });
    password.value = 'incorrecta';
    w.iniciarSesion();
    assert.equal(w.localStorage.getItem('comandas.ultimoAcceso.v1'), saved);
    w.close();
    const restored = await open(null, false, saved);
    assert.equal(restored.document.getElementById('usuario').value, 'admin');
    assert.equal(restored.document.getElementById('contrasena').value, '1234');
    assert.equal(restored.document.querySelector('.screen.active').id, 'login-screen');
    restored.close();
});

test('unavailable or malformed login storage does not prevent login', async () => {
    for (const [unavailable, acceso] of [[true, null], [false, '{invalid']]) {
        const w = await open(null, unavailable, acceso);
        w.document.getElementById('usuario').value = 'admin';
        w.document.getElementById('contrasena').value = '1234';
        w.iniciarSesion();
        assert.equal(w.document.querySelector('.screen.active').id, 'seleccion-mesas-screen');
        w.close();
    }
});

test('menu categories stay available and product badges follow the selected account draft', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    const category = w.document.querySelector('[data-categoria="platos"]');
    category.click();
    assert.equal(category.getAttribute('aria-pressed'), 'true');
    assert.equal(w.document.querySelectorAll('#categories button').length, 6);
    const pizza = () => w.document.querySelector('[data-producto="Pizza"]');
    pizza().click();
    pizza().click();
    assert.equal(pizza().querySelector('.product-quantity').textContent, '2 en esta cuenta');
    w.document.getElementById('cuentas').value = '2';
    w.actualizarCuentas();
    assert.equal(pizza().querySelector('.product-quantity').textContent, '+ Añadir');
    assert.equal(w.document.getElementById('menu-cuenta').textContent, 'Añadiendo a Cuenta 2');
    pizza().click();
    assert.equal(pizza().querySelector('.product-quantity').textContent, '1 en esta cuenta');
    w.disminuirCantidad('Pizza', 2);
    assert.equal(pizza().querySelector('.product-quantity').textContent, '+ Añadir');
    w.document.querySelector('[data-categoria="bebidas"]').click();
    assert.equal(category.getAttribute('aria-pressed'), 'false');
    w.document.getElementById('cuentas').value = '1';
    w.actualizarCuentas();
    category.click();
    assert.equal(pizza().querySelector('.product-quantity').textContent, '2 en esta cuenta');
    w.enviarCocina();
    w.seleccionarMesa(1);
    assert.equal(pizza().querySelector('.product-quantity').textContent, '+ Añadir');
    w.close();
});
