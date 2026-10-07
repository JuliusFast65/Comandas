const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');
const key = 'comandas.estado.v1';

async function open(saved, unavailable = false) {
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
