const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');
const key = 'comandas.estado.v1';

async function open(saved, unavailable = false, acceso = null, precios = null, meseros = null) {
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
    if (precios) w.localStorage.setItem('comandas.precios.v1', precios);
    if (meseros) w.localStorage.setItem('comandas.meseros.v1', meseros);
    if (acceso) w.localStorage.setItem('comandas.ultimoAcceso.v1', acceso);
    if (unavailable) Object.defineProperty(w, 'localStorage', { get() { throw new Error('Unavailable'); } });
    w.eval(fs.readFileSync(path.join(root, 'scripts.js'), 'utf8') + '\nwindow.inicioRestaurado = () => tiemposDePreparacion[0]?.inicio;');
    await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    assert.deepEqual(errors, []);
    return w;
}

function completarYPagarDemo(w) {
    const state = JSON.parse(w.localStorage.getItem(key));
    const accounts = [...new Set(state.mesas[0].ordenes.flatMap(g => g.items.map(i => String(i.cuenta))))];
    for (const account of accounts) {
        for (const [id, value] of Object.entries({ cedula: '1234567890', 'nombre-completo': 'Cliente demo', direccion: 'Demo', telefono: '0999999999', correo: 'demo@example.test' })) {
            w.document.getElementById(id).value = value;
        }
        w.confirmarFacturacion();
    }
    for (const account of accounts) {
        w.enviarCuentaLSoft(account);
        w.simularPagoLSoft(account, 'efectivo');
    }
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

test('withdrawn rows disappear, history is collapsed, and additional orders reappear', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.agregarProducto('Pasta');
    w.agregarProducto('Coca-Cola');
    w.enviarCocina();
    w.marcarPreparado('mesa', 1, 1, 0, true);
    w.retirarProducto('mesa', 1, 1, 0, 1);
    assert.doesNotMatch(w.document.getElementById('cocina-list').textContent, /Pizza/);
    assert.match(w.document.getElementById('cocina-list').textContent, /Pasta/);
    assert.match(w.document.getElementById('cocina-retirados').textContent, /Pizza/);
    assert.equal(w.document.querySelector('.withdrawn-history').open, false);
    w.marcarPreparado('mesa', 1, 1, 1, true);
    w.retirarTodoListo('mesa', 1, 'cocina');
    assert.equal(w.document.querySelectorAll('#cocina-list .preparation-card').length, 0);
    assert.match(w.document.getElementById('cocina-list').textContent, /Todo al día/);
    assert.match(w.document.getElementById('bar-list').textContent, /Coca-Cola/);
    const saved = w.localStorage.getItem(key);
    w.close();
    const restored = await open(saved);
    assert.equal(restored.document.querySelectorAll('#cocina-list .preparation-card').length, 0);
    assert.equal(restored.document.getElementById('cocina-retirados-titulo').textContent, 'Ver retirados (2)');
    restored.seleccionarMesa(1);
    restored.agregarProducto('Pizza');
    restored.enviarCocina();
    assert.equal(restored.document.querySelectorAll('#cocina-list .preparation-row').length, 1);
    assert.match(restored.document.getElementById('cocina-list').textContent, /Adicional/);
    restored.pedirCuenta();
    completarYPagarDemo(restored);
    restored.confirmarFacturacionFinal();
    assert.equal(restored.document.querySelectorAll('#cocina-list .preparation-card').length, 0);
    assert.equal(restored.document.querySelectorAll('#bar-list .preparation-card').length, 0);
    assert.equal(restored.document.getElementById('cocina-retirados-titulo').textContent, 'Ver retirados (0)');
    restored.close();
});

test('search spans categories, ignores accents, and preserves account quantities', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    w.showProducts('platos');
    const input = w.document.getElementById('buscar-producto');
    const search = value => { input.value = value; input.dispatchEvent(new w.Event('input')); };
    search('CAFE');
    const coffee = w.document.querySelector('[data-producto="Café"]');
    assert.ok(coffee);
    assert.match(coffee.textContent, /Bebidas/);
    coffee.click();
    assert.match(coffee.textContent, /1 en esta cuenta/);
    w.document.getElementById('cuentas').value = '2';
    w.actualizarCuentas();
    assert.match(coffee.textContent, /Añadir/);
    search('zzzzzz');
    assert.equal(w.document.querySelectorAll('#products .product').length, 0);
    assert.match(w.document.getElementById('products').textContent, /No encontramos/);
    w.document.getElementById('limpiar-busqueda').click();
    assert.ok(w.document.querySelector('[data-producto="Pizza"]'));
    assert.equal(w.document.activeElement, input);
    search('pizza');
    w.document.querySelector('[data-categoria="bebidas"]').click();
    assert.equal(input.value, '');
    assert.ok(w.document.querySelector('[data-producto="Café"]'));
    w.close();
});

test('request bill opens unnamed product accounts and can be reopened', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.enviarCocina();
    w.marcarPreparado('mesa', 1, 1, 0, true);
    w.retirarTodoListo('mesa', 1);
    w.seleccionarMesa(1);
    w.pedirCuenta();
    assert.equal(w.document.querySelector('.screen.active').id, 'facturacion-screen');
    w.showScreen('seleccion-mesas-screen');
    w.pedirCuenta();
    assert.equal(w.document.querySelector('.screen.active').id, 'facturacion-screen');
    assert.match(w.document.getElementById('factura-info').textContent, /Cuenta 1/);
    w.close();
});

test('prebill separates consumption by account, prints blank fields and saves optional tips', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.agregarProducto('Pizza');
    w.document.getElementById('cuentas').value = '2';
    w.agregarProducto('Coca-Cola');
    w.enviarCocina();
    w.pedirCuenta();
    const consumption = () => w.document.getElementById('precuenta-consumo').textContent;
    assert.match(consumption(), /Pizza/);
    assert.doesNotMatch(consumption(), /Coca-Cola/);
    assert.equal(w.document.querySelector('#precuenta-consumo tbody td:nth-child(2)').textContent, '2');
    let prints = 0;
    w.print = () => prints++;
    w.imprimirPrecuenta();
    assert.equal(prints, 1);
    assert.match(w.document.getElementById('precuenta-impresion').textContent, /Cédula\/RUC: _/);
    const fill = () => {
        for (const [id, value] of Object.entries({ cedula: '1234567890', 'nombre-completo': 'Cliente demo',
            direccion: 'Dirección demo', telefono: '0999999999', correo: 'demo@example.test' })) {
            w.document.getElementById(id).value = value;
        }
    };
    fill();
    w.document.getElementById('propina').value = '-1';
    w.confirmarFacturacion();
    assert.match(w.document.getElementById('aviso-titulo').textContent, /propina/);
    w.document.getElementById('propina').value = '2.50';
    w.imprimirPrecuenta();
    assert.match(w.document.getElementById('precuenta-impresion').textContent, /2.50/);
    w.confirmarFacturacion();
    assert.match(consumption(), /Coca-Cola/);
    assert.doesNotMatch(consumption(), /Pizza/);
    assert.equal(w.document.getElementById('cedula').value, '');
    assert.equal(w.document.getElementById('propina').value, '');
    fill();
    w.confirmarFacturacion();
    w.seleccionarMesa(1);
    w.pedirCuenta();
    assert.equal(w.document.getElementById('propina').value, '2.5');
    assert.equal(w.document.getElementById('nombre-completo').value, 'Cliente demo');
    assert.ok(w.document.querySelector('#mesas .mesa.ocupada'));
    w.close();
});


test('prices include additive IVA and service, separate mode and existing orders retain rates', async () => {
    const w = await open();
    w.abrirConfiguracion();
    w.document.querySelector('#config-precios input[data-producto="Pizza"]').value = '12.50';
    w.guardarConfiguracion();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.enviarCocina();
    w.pedirCuenta();
    const totals = () => [...w.document.querySelectorAll('#precuenta-consumo tfoot td')].map(td => td.textContent);
    assert.deepEqual(totals(), ['$10.00', '$1.50', '$1.00', '$12.50', '$0.00', '$12.50']);
    w.document.getElementById('propina').value = '2';
    w.document.getElementById('propina').dispatchEvent(new w.Event('input'));
    assert.equal(totals().at(-1), '$14.50');
    w.abrirConfiguracion();
    w.document.getElementById('config-incluidos').value = 'separados';
    w.document.querySelector('#config-precios input[data-producto="Pizza"]').value = '10';
    w.guardarConfiguracion();
    w.seleccionarMesa(1);
    w.pedirCuenta();
    assert.equal(totals()[3], '$12.50');
    w.seleccionarMesa(2);
    w.agregarProducto('Pizza');
    w.enviarCocina();
    w.pedirCuenta();
    assert.deepEqual(totals(), ['$10.00', '$1.50', '$1.00', '$12.50', '$0.00', '$12.50']);
    const saved = JSON.parse(w.localStorage.getItem('comandas.precios.v1'));
    assert.equal(saved.iva, 15);
    assert.equal(saved.servicio, 10);
    assert.equal(saved.incluidos, false);
    w.close();
});


test('price settings reload, disabled service and invalid settings preserve configuration', async () => {
    const w = await open();
    w.abrirConfiguracion();
    w.document.getElementById('config-servicio').value = '0';
    w.document.querySelector('#config-precios input[data-producto="Pizza"]').value = '11.50';
    w.guardarConfiguracion();
    const saved = w.localStorage.getItem('comandas.precios.v1');
    w.abrirConfiguracion();
    w.document.getElementById('config-iva').value = '-1';
    w.guardarConfiguracion();
    assert.equal(w.localStorage.getItem('comandas.precios.v1'), saved);
    w.close();
    const restored = await open(null, false, null, saved);
    restored.seleccionarMesa(1);
    restored.showProducts('platos');
    assert.match(restored.document.querySelector('[data-producto="Pizza"] .product-price').textContent, /11.50/);
    restored.agregarProducto('Pizza');
    restored.enviarCocina();
    restored.pedirCuenta();
    const amounts = [...restored.document.querySelectorAll('#precuenta-consumo tfoot td')].map(td => td.textContent);
    assert.deepEqual(amounts, ['$10.00', '$1.50', '$0.00', '$11.50', '$0.00', '$11.50']);
    restored.close();
});

test('waiter badges, automatic assignment, filtering, reassignment and reload', async () => {
    const w = await open();
    w.configurarMeseros();
    w.document.getElementById('lista-meseros').value = 'Ana Martínez\nLuis Pérez';
    w.guardarMeseros();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.enviarCocina();
    assert.equal(w.document.querySelector('#mesas .waiter-badge').textContent, 'AM');
    assert.match(w.document.querySelector('#mesas .mesa').textContent, /Ana Martínez/);
    w.document.getElementById('mesero-activo').value = 'Luis Pérez';
    w.cambiarMeseroActivo();
    w.seleccionarMesa(1);
    assert.equal(w.document.getElementById('mesero-mesa').value, 'Ana Martínez');
    w.document.getElementById('filtro-mesas').value = 'mis';
    w.cambiarFiltroMesas();
    assert.ok(![...w.document.querySelectorAll('#mesas strong')].some(n => n.textContent === 'Mesa 1'));
    assert.match(w.document.getElementById('mesas').textContent, /Mesa 2/);
    w.document.getElementById('mesero-mesa').value = 'Luis Pérez';
    w.reasignarMesa();
    assert.ok([...w.document.querySelectorAll('#mesas strong')].some(n => n.textContent === 'Mesa 1'));
    const saved = w.localStorage.getItem(key);
    const team = w.localStorage.getItem('comandas.meseros.v1');
    w.close();
    const restored = await open(saved, false, null, null, team);
    assert.equal(restored.document.getElementById('mesero-activo').value, 'Luis Pérez');
    assert.equal(restored.document.querySelector('#mesas .waiter-badge').textContent, 'LP');
    restored.seleccionarMesa(1);
    restored.pedirCuenta();
    completarYPagarDemo(restored);
    restored.confirmarFacturacionFinal();
    assert.equal(restored.document.querySelector('#mesas .mesa .waiter-badge'), null);
    assert.match(restored.document.querySelector('#mesas .mesa').textContent, /Sin asignar/);
    restored.close();
});

test('simulated LSoft retries are idempotent, payment gates closure and closed operations survive', async () => {
    const w = await open();
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza');
    w.document.getElementById('cuentas').value = '2';
    w.agregarProducto('Coca-Cola');
    w.enviarCocina();
    w.pedirCuenta();
    for (let index = 0; index < 2; index++) {
        for (const [id, value] of Object.entries({ cedula: '1234567890', 'nombre-completo': 'Cliente demo', direccion: 'Demo', telefono: '0999999999', correo: 'demo@example.test' })) w.document.getElementById(id).value = value;
        w.document.getElementById('propina').value = index === 0 ? '1' : '';
        w.confirmarFacturacion();
    }
    w.enviarCuentaLSoft('1');
    w.enviarCuentaLSoft('1');
    const documents = () => JSON.parse(w.localStorage.getItem('comandas.lsoftSim.v1'));
    assert.equal(Object.keys(documents()).length, 1);
    const first = Object.values(documents())[0];
    assert.equal(first.json.moneda, 'USD');
    assert.equal(first.json.totalesCentavos.propina, 100);
    assert.equal(first.json.totalesCentavos.pagar, first.json.totalesCentavos.total + 100);
    w.confirmarFacturacionFinal();
    assert.ok(w.document.querySelector('#mesas .mesa.ocupada'));
    w.simularPagoLSoft('1', 'tarjeta');
    assert.equal(w.document.getElementById('cerrar-mesa').disabled, true);
    w.enviarCuentaLSoft('2');
    w.simularPagoLSoft('2', 'efectivo');
    assert.equal(w.document.getElementById('cerrar-mesa').disabled, false);
    w.confirmarFacturacionFinal();
    assert.equal(w.document.querySelector('#mesas .mesa.ocupada'), null);
    const closed = JSON.parse(w.localStorage.getItem('comandas.cierres.v1'));
    assert.equal(closed.length, 1);
    assert.equal(closed[0].cuentas.length, 2);
    assert.equal(closed[0].cuentas[0].resultado.estado, 'pagado');
    w.seleccionarMesa(1);
    w.agregarProducto('Pizza'); w.enviarCocina(); w.pedirCuenta();
    assert.equal(w.document.getElementById('cerrar-mesa').disabled, true);
    assert.equal(JSON.parse(w.localStorage.getItem(key)).mesas[0].operacionId, null);
    w.close();
});

test('billing and simulated LSoft state recover after reload and preserve operation key', async () => {
    const w = await open();
    w.seleccionarMesa(1); w.agregarProducto('Pizza'); w.enviarCocina(); w.pedirCuenta();
    completarYPagarDemo(w);
    const state = w.localStorage.getItem(key);
    const simulated = w.localStorage.getItem('comandas.lsoftSim.v1');
    const id = JSON.parse(state).mesas[0].integracion['1'].clave;
    w.close();
    const restored = await open(state);
    restored.localStorage.setItem('comandas.lsoftSim.v1', simulated);
    restored.seleccionarMesa(1); restored.pedirCuenta();
    assert.equal(restored.document.getElementById('nombre-completo').value, 'Cliente demo');
    restored.enviarCuentaLSoft('1');
    assert.equal(Object.keys(JSON.parse(restored.localStorage.getItem('comandas.lsoftSim.v1'))).length, 1);
    assert.equal(JSON.parse(restored.localStorage.getItem(key)).mesas[0].integracion['1'].clave, id);
    assert.equal(restored.document.getElementById('cerrar-mesa').disabled, false);
    restored.close();
});

test('failed simulated receipt does not report success and a retry recovers', async () => {
    const w = await open();
    w.seleccionarMesa(1); w.agregarProducto('Pizza'); w.enviarCocina(); w.pedirCuenta();
    for (const [id, value] of Object.entries({ cedula: '1234567890', 'nombre-completo': 'Demo', direccion: 'Demo', telefono: '0999999999', correo: 'demo@example.test' })) w.document.getElementById(id).value = value;
    w.confirmarFacturacion();
    const original = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = function (key, value) {
        if (key === 'comandas.lsoftSim.v1') throw new Error('Fallo simulado de recepción');
        return original.call(this, key, value);
    };
    w.enviarCuentaLSoft('1');
    assert.equal(JSON.parse(w.localStorage.getItem(key)).mesas[0].integracion, undefined);
    assert.equal(w.document.getElementById('aviso-titulo').textContent, 'No se pudo enviar');
    w.Storage.prototype.setItem = original;
    w.enviarCuentaLSoft('1');
    assert.equal(Object.keys(JSON.parse(w.localStorage.getItem('comandas.lsoftSim.v1'))).length, 1);
    assert.equal(w.document.getElementById('cerrar-mesa').disabled, true);
    w.close();
});

test('header navigation, menu dismissal and logout preserve orders and distinguish waiter from user', async () => {
    const w = await open();
    assert.equal(w.document.getElementById('app-topbar').hidden, true);
    w.document.getElementById('usuario').value = 'admin';
    w.document.getElementById('contrasena').value = '1234';
    w.iniciarSesion();
    assert.equal(w.document.getElementById('app-topbar').hidden, false);
    assert.equal(w.document.getElementById('user-name').textContent, 'admin');
    w.document.getElementById('abrir-menu').click();
    const menu = w.document.getElementById('app-menu');
    assert.ok(menu.open);
    assert.equal(w.document.getElementById('abrir-menu').getAttribute('aria-expanded'), 'true');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(menu.open, false);
    assert.equal(w.document.getElementById('abrir-menu').getAttribute('aria-expanded'), 'false');
    w.abrirMenu();
    menu.querySelectorAll('nav > button')[0].click();
    assert.equal(menu.open, false);
    assert.equal(w.document.querySelector('.screen.active').id, 'configuracion-screen');
    w.abrirMenu();
    menu.click();
    assert.equal(menu.open, false);
    w.showScreen('seleccion-mesas-screen');
    w.seleccionarMesa(1); w.agregarProducto('Pizza'); w.enviarCocina();
    w.document.getElementById('aviso-dialogo').close();
    w.cerrarSesion();
    assert.equal(w.document.querySelector('.screen.active').id, 'login-screen');
    assert.equal(w.document.getElementById('app-topbar').hidden, true);
    assert.equal(w.document.activeElement.id, 'usuario');
    const state = JSON.parse(w.localStorage.getItem(key));
    assert.equal(state.mesas[0].ordenes[1].items[0].nombre, 'Pizza');
    assert.equal(state.mesas[0].mesero, 'Mesero 1');
    w.iniciarSesion();
    assert.equal(w.document.querySelector('.screen.active').id, 'seleccion-mesas-screen');
    assert.equal(w.document.getElementById('user-name').textContent, 'admin');
    w.close();
});
