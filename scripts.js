const productos = {
    entradas: ['Bruschetta', 'Nachos', 'Quesadilla', 'Calamares', 'Alitas de Pollo', 'Tacos', 'Ceviche', 'Empanadas', 'Hummus', 'Mozzarella Sticks', 'Samosas', 'Spring Rolls', 'Dumplings', 'Guacamole', 'Carpaccio'],
    platos: ['Pizza', 'Pasta', 'Hamburguesa', 'Ensalada', 'Sushi', 'Burrito', 'Paella', 'Risotto', 'Pollo Asado', 'Steak', 'Lasaña', 'Fajitas', 'Costillas BBQ', 'Shawarma', 'Fish & Chips'],
    postres: ['Tarta de Queso', 'Brownie', 'Helado', 'Fruta', 'Tiramisú', 'Crème Brûlée', 'Panna Cotta', 'Pastel de Zanahoria', 'Mousse de Chocolate', 'Gelatina', 'Flan', 'Profiteroles', 'Trifle', 'Tarta de Manzana', 'Tarta de Limón'],
    bebidas: ['Coca-Cola', 'Jugo de Naranja', 'Agua', 'Té Helado', 'Limonada', 'Café', 'Chocolate Caliente', 'Batido de Fresa', 'Batido de Chocolate', 'Agua con Gas', 'Red Bull', 'Sprite', 'Fanta'],
    bebidasAlcoolicas: ['Vino Tinto', 'Vino Blanco', 'Cerveza', 'Whisky', 'Tequila', 'Vodka', 'Ginebra', 'Ron', 'Brandy', 'Licor', 'Champán', 'Sangría', 'Margarita', 'Martini', 'Bloody Mary'],
    adicionales: ['Papas Fritas', 'Arroz', 'Ensalada', 'Guacamole', 'Queso', 'Tortillas', 'Frijoles', 'Salsa', 'Pan', 'Aguacate', 'Tocino', 'Champiñones', 'Aros de Cebolla', 'Purée de Papas', 'Maíz']
};

const CLAVE_PRECIOS = 'comandas.precios.v1';
let configuracionPrecios = { iva: 15, servicio: 10, incluidos: true, precios: {} };
const dinero = centavos => `$${(centavos / 100).toFixed(2)}`;
const centavos = valor => Math.round(Number(valor) * 100);

function iniciarPrecios() {
    const valoresDemo = { entradas: 5, platos: 10, postres: 4, bebidas: 2.5, bebidasAlcoolicas: 6, adicionales: 2 };
    Object.entries(productos).forEach(([grupo, nombres]) => nombres.forEach(nombre => {
        if (configuracionPrecios.precios[nombre] === undefined) configuracionPrecios.precios[nombre] = centavos(valoresDemo[grupo]);
    }));
    try {
        const guardada = JSON.parse(localStorage.getItem(CLAVE_PRECIOS));
        if (guardada && typeof guardada.incluidos === 'boolean'
            && [guardada.iva, guardada.servicio].every(n => Number.isFinite(n) && n >= 0 && n <= 100)
            && guardada.precios && Object.values(guardada.precios).every(n => Number.isSafeInteger(n) && n >= 0)) {
            configuracionPrecios = { ...guardada, precios: { ...configuracionPrecios.precios, ...guardada.precios } };
        }
    } catch { console.warn('No se pudo recuperar la configuración de precios.'); }
    // Los pedidos anteriores reciben la tarifa vigente al activar esta versión.
    [...mesas, ...paraLlevarOrdenes].forEach(pedido => pedido.ordenes.forEach(grupo => grupo.items.forEach(item => {
        if (!item.tarifa) item.tarifa = tarifaProducto(item.nombre);
    })));
}

function tarifaProducto(nombre) {
    return { precio: configuracionPrecios.precios[nombre] || 0, iva: configuracionPrecios.iva,
        servicio: configuracionPrecios.servicio, incluidos: configuracionPrecios.incluidos };
}

function calcularImportes(tarifa, cantidad = 1) {
    const importe = tarifa.precio * cantidad;
    if (tarifa.incluidos) {
        const base = Math.round(importe / (1 + (tarifa.iva + tarifa.servicio) / 100));
        const iva = tarifa.servicio === 0 ? importe - base : Math.round(base * tarifa.iva / 100);
        // Asignamos el redondeo al servicio para conservar exactamente el precio final.
        const servicio = importe - base - iva;
        return { base, iva, servicio, total: importe };
    }
    const iva = Math.round(importe * tarifa.iva / 100);
    const servicio = Math.round(importe * tarifa.servicio / 100);
    return { base: importe, iva, servicio, total: importe + iva + servicio };
}

function abrirConfiguracion() {
    if (!exigirPermiso('administrar')) return;
    document.getElementById('config-iva').value = configuracionPrecios.iva;
    document.getElementById('config-servicio').value = configuracionPrecios.servicio;
    document.getElementById('config-incluidos').value = configuracionPrecios.incluidos ? 'incluidos' : 'separados';
    const lista = document.getElementById('config-precios');
    lista.replaceChildren();
    Object.entries(configuracionPrecios.precios).forEach(([nombre, precio]) => {
        const etiqueta = document.createElement('label');
        etiqueta.textContent = nombre;
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.max = '100000'; input.step = '0.01'; input.required = true;
        input.value = (precio / 100).toFixed(2); input.dataset.producto = nombre;
        input.setAttribute('aria-label', `Precio de ${nombre}`);
        etiqueta.appendChild(input); lista.appendChild(etiqueta);
    });
    showScreen('configuracion-screen');
}

function guardarConfiguracion() {
    if (!exigirPermiso('administrar')) return;
    const iva = Number(document.getElementById('config-iva').value);
    const servicio = Number(document.getElementById('config-servicio').value);
    const inputs = [...document.querySelectorAll('#configuracion-screen input')];
    if (inputs.some(input => !input.checkValidity() || input.value === '')
        || ![iva, servicio].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) {
        mostrarAviso('Revisa los porcentajes y precios. Los valores deben ser positivos o cero.', 'Configuración inválida', 'aviso'); return;
    }
    const nueva = { iva, servicio, incluidos: document.getElementById('config-incluidos').value === 'incluidos', precios: {} };
    document.querySelectorAll('#config-precios input').forEach(input => nueva.precios[input.dataset.producto] = centavos(input.value));
    try { localStorage.setItem(CLAVE_PRECIOS, JSON.stringify(nueva)); }
    catch { mostrarAviso('No se pudo guardar la configuración en este navegador.', 'No se guardó', 'aviso'); return; }
    configuracionPrecios = nueva;
    guardarEstado();
    showScreen('seleccion-mesas-screen');
    mostrarAviso('Los nuevos productos usarán estos precios y cargos. Los ya pedidos conservan su tarifa.', 'Configuración guardada');
}

function totalesCuenta(pedido, cuenta) {
    return itemsEnviados(pedido).filter(({ item }) => String(item.cuenta) === String(cuenta)).reduce((suma, { item }) => {
        const importes = calcularImportes(item.tarifa || tarifaProducto(item.nombre), item.cantidad);
        for (const clave of ['base', 'iva', 'servicio', 'total']) suma[clave] += importes[clave];
        return suma;
    }, { base: 0, iva: 0, servicio: 0, total: 0 });
}

const CLAVE_MESEROS = 'comandas.meseros.v1';
let equipoMeseros = { nombres: ['Mesero 1', 'Mesero 2'], activo: 'Mesero 1' };
let filtroMisMesas = false;

function iniciarMeseros() {
    try {
        const guardado = JSON.parse(localStorage.getItem(CLAVE_MESEROS));
        if (guardado && Array.isArray(guardado.nombres) && guardado.nombres.length
            && guardado.nombres.every(n => typeof n === 'string' && n.trim())
            && guardado.nombres.includes(guardado.activo)) equipoMeseros = guardado;
    } catch { console.warn('No se pudo recuperar el equipo de meseros.'); }
    renderizarSelectorMesero();
}

function opcionesMeseros(selector, actual) {
    selector.replaceChildren();
    [...new Set([...equipoMeseros.nombres, actual].filter(Boolean))].forEach(nombre => {
        const opcion = document.createElement('option'); opcion.value = nombre; opcion.textContent = nombre;
        selector.appendChild(opcion);
    });
    selector.value = actual;
}

function renderizarSelectorMesero() {
    opcionesMeseros(document.getElementById('mesero-activo'), equipoMeseros.activo);
}

function cambiarMeseroActivo() {
    if (!exigirPermiso('administrar')) return;
    const activo = document.getElementById('mesero-activo').value;
    try { localStorage.setItem(CLAVE_MESEROS, JSON.stringify({ ...equipoMeseros, activo })); }
    catch { mostrarAviso('No se pudo guardar el mesero activo.', 'No se guardó', 'aviso'); renderizarSelectorMesero(); return; }
    equipoMeseros.activo = activo;
    mostrarMesas(); mostrarParaLlevar();
}

function configurarMeseros() {
    if (!exigirPermiso('administrar')) return;
    document.getElementById('lista-meseros').value = equipoMeseros.nombres.join('\n');
    showScreen('meseros-screen');
}

function guardarMeseros() {
    if (!exigirPermiso('administrar')) return;
    const nombres = [...new Set(document.getElementById('lista-meseros').value.split('\n').map(n => n.trim()).filter(Boolean))];
    if (!nombres.length || nombres.length > 50 || nombres.some(n => n.length > 60)) {
        mostrarAviso('Escribe entre 1 y 50 nombres, de hasta 60 caracteres cada uno.', 'Revisa la lista', 'aviso'); return;
    }
    const nuevo = { nombres, activo: nombres.includes(equipoMeseros.activo) ? equipoMeseros.activo : nombres[0] };
    try { localStorage.setItem(CLAVE_MESEROS, JSON.stringify(nuevo)); }
    catch { mostrarAviso('No se pudo guardar la lista.', 'No se guardó', 'aviso'); return; }
    equipoMeseros = nuevo;
    renderizarSelectorMesero(); mostrarMesas(); mostrarParaLlevar();
    showScreen('seleccion-mesas-screen');
}

function asignarAlAbrir(pedido) {
    if (!pedido.mesero) {
        pedido.mesero = equipoMeseros.activo;
        guardarEstado(); mostrarMesas(); mostrarParaLlevar();
    }
    opcionesMeseros(document.getElementById('mesero-mesa'), pedido.mesero);
}

function reasignarMesa() {
    if (!exigirPermiso('administrar')) return;
    if (!mesaSeleccionada) return;
    mesaSeleccionada.mesero = document.getElementById('mesero-mesa').value;
    guardarEstado(); mostrarMesas(); mostrarParaLlevar();
}

function cambiarFiltroMesas() {
    filtroMisMesas = document.getElementById('filtro-mesas').value === 'mis';
    mostrarMesas(); mostrarParaLlevar();
}

function visibleParaMesero(pedido) {
    return !filtroMisMesas || pedido.mesero === equipoMeseros.activo || (!pedido.ocupada && !pedido.mesero);
}

// Contrato provisional: adaptador local, sin llamadas a LSoft ni al SRI.
const CLAVE_LSOFT = 'comandas.lsoftSim.v1';
const CLAVE_CIERRES = 'comandas.cierres.v1';
class LSoftSimulado {
    leer() { return JSON.parse(localStorage.getItem(CLAVE_LSOFT) || '{}'); }
    enviar(json) {
        const documentos = this.leer();
        const anterior = documentos[json.idOperacion];
        if (anterior) {
            if (JSON.stringify(anterior.json) !== JSON.stringify(json)) throw new Error('El pedido cambió después del envío. No se puede reutilizar su identificador con otros datos.');
            return anterior.respuesta;
        }
        const respuesta = { pedidoId: `SIM-P-${Object.keys(documentos).length + 1}`,
            facturaId: `SIM-F-${Object.keys(documentos).length + 1}`, estado: 'pendiente_pago', sri: 'no_aplica_simulacion' };
        documentos[json.idOperacion] = { json, respuesta };
        localStorage.setItem(CLAVE_LSOFT, JSON.stringify(documentos));
        return respuesta;
    }
    consultar(clave) {
        const documento = this.leer()[clave];
        if (!documento) throw new Error('Pedido no encontrado en el simulador.');
        return documento.respuesta;
    }
    pagar(clave, medio) {
        if (!['efectivo', 'tarjeta', 'transferencia'].includes(medio)) throw new Error('Medio de pago inválido.');
        const documentos = this.leer();
        if (!documentos[clave]) throw new Error('Primero envía el pedido.');
        const respuesta = documentos[clave].respuesta;
        if (respuesta.estado !== 'pagado') Object.assign(respuesta, { estado: 'pagado', medioPago: medio, pagadoEn: new Date().toISOString() });
        localStorage.setItem(CLAVE_LSOFT, JSON.stringify(documentos));
        return respuesta;
    }
}
const adaptadorLSoft = new LSoftSimulado();

function identidadOperacion(pedido) {
    if (!pedido.operacionId) pedido.operacionId = 'COM-' + [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
    return pedido.operacionId;
}

function contratoPedido(pedido, cuenta) {
    const cliente = pedido.factura?.[cuenta];
    if (!cliente) throw new Error('Completa primero los datos de facturación de esta cuenta.');
    const total = totalesCuenta(pedido, cuenta);
    const propina = centavos(cliente.propina || 0);
    return { version: '0.1-provisional', idOperacion: `${identidadOperacion(pedido)}-C${cuenta}`, moneda: 'USD',
        origen: { sistema: 'Comandas', tipo: mesas.includes(pedido) ? 'mesa' : 'para_llevar', numero: pedido.numero,
            cuenta: String(cuenta), mesero: pedido.mesero || null },
        cliente: { identificacion: cliente.cedula, nombre: cliente.nombreCompleto, direccion: cliente.direccion,
            telefono: cliente.telefono, correo: cliente.correo },
        lineas: itemsEnviados(pedido).filter(({ item }) => String(item.cuenta) === String(cuenta)).map(({ item }, index) => {
            const tarifa = item.tarifa || tarifaProducto(item.nombre);
            return { linea: index + 1, productoReferencia: item.nombre, cantidad: item.cantidad,
                nota: item.nota || '', precioUnitarioCentavos: tarifa.precio, incluyeCargos: tarifa.incluidos,
                ivaPorcentaje: tarifa.iva, servicioPorcentaje: tarifa.servicio,
                importesCentavos: calcularImportes(tarifa, item.cantidad) };
        }),
        totalesCentavos: { ...total, propina, pagar: total.total + propina } };
}

function enviarCuentaLSoft(cuenta, actualizarVista = true) {
    if (!exigirPermiso('operar', ordenParaFacturar)) return false;
    try {
        const json = contratoPedido(ordenParaFacturar, cuenta);
        if (!guardarEstado()) throw new Error('No se puede enviar sin guardar primero el identificador del pedido.');
        const respuesta = adaptadorLSoft.enviar(json);
        ordenParaFacturar.integracion ||= {};
        ordenParaFacturar.integracion[cuenta] = { clave: json.idOperacion, ...respuesta };
        if (ordenParaFacturar.erroresLSoft) delete ordenParaFacturar.erroresLSoft[cuenta];
        guardarEstado(); mostrarCaja();
        if (actualizarVista) seleccionarParaFacturacion(ordenParaFacturar);
        return true;
    } catch (error) {
        ordenParaFacturar.erroresLSoft ||= {};
        ordenParaFacturar.erroresLSoft[cuenta] = error.message;
        guardarEstado(); mostrarCaja();
        mostrarAviso(error.message, 'No se pudo enviar', 'aviso');
        return false;
    }
}

function consultarCuentaLSoft(cuenta) {
    if (!exigirPermiso('consulta', ordenParaFacturar)) return;
    try {
        const registro = ordenParaFacturar.integracion?.[cuenta];
        if (!registro) throw new Error('Primero envía el pedido.');
        Object.assign(registro, adaptadorLSoft.consultar(registro.clave));
        guardarEstado(); seleccionarParaFacturacion(ordenParaFacturar);
    } catch (error) { mostrarAviso(error.message, 'No se pudo consultar', 'aviso'); }
}

function simularPagoLSoft(cuenta, medio) {
    if (!exigirPermiso('administrar')) return;
    try {
        const registro = ordenParaFacturar.integracion?.[cuenta];
        if (!registro) throw new Error('Primero envía el pedido.');
        adaptadorLSoft.pagar(registro.clave, medio);
        // El cobro sucede en el simulador; Comandas consulta la respuesta.
        consultarCuentaLSoft(cuenta);
    } catch (error) { mostrarAviso(error.message, 'No se pudo simular el pago', 'aviso'); }
}

function mostrarJSONLSoft(cuenta) {
    if (!exigirPermiso('consulta', ordenParaFacturar)) return;
    try {
        const json = contratoPedido(ordenParaFacturar, cuenta);
        const salida = document.getElementById('lsoft-json');
        salida.textContent = JSON.stringify(json, null, 2);
        document.getElementById('lsoft-json-detalle').open = true;
    } catch (error) { mostrarAviso(error.message, 'Datos pendientes', 'aviso'); }
}

function controlesLSoft(cuenta) {
    const panel = document.createElement('section'); panel.className = 'lsoft-controls';
    const estado = ordenParaFacturar.integracion?.[cuenta];
    const etiqueta = document.createElement('p');
    etiqueta.textContent = estado ? `${estado.pedidoId} · ${estado.estado === 'pagado' ? 'Pagado (simulado)' : 'Pendiente de pago en LSoft (simulado)'}` : ordenParaFacturar.erroresLSoft?.[cuenta] ? `Error de envío: ${ordenParaFacturar.erroresLSoft[cuenta]}` : 'Sin enviar a LSoft';
    panel.appendChild(etiqueta);
    const accion = (texto, callback, desactivado = false) => {
        const boton = document.createElement('button'); boton.className = 'pickup-button'; boton.textContent = texto;
        boton.disabled = desactivado; boton.onclick = callback; panel.appendChild(boton);
    };
    accion('Ver JSON', () => mostrarJSONLSoft(cuenta));
    if (permite('operar', ordenParaFacturar)) accion(estado ? 'Reintentar envío' : 'Enviar a LSoft (simulado)', () => enviarCuentaLSoft(cuenta), !ordenParaFacturar.factura?.[cuenta]);
    accion('Consultar estado', () => consultarCuentaLSoft(cuenta), !estado);
    if (permite('administrar') && estado && estado.estado !== 'pagado') {
        const medio = document.createElement('select'); medio.setAttribute('aria-label', `Medio de pago simulado de cuenta ${cuenta}`);
        for (const nombre of ['efectivo', 'tarjeta', 'transferencia']) {
            const opcion = document.createElement('option'); opcion.value = nombre; opcion.textContent = nombre; medio.appendChild(opcion);
        }
        panel.appendChild(medio);
        accion('Simular cobro en LSoft', () => simularPagoLSoft(cuenta, medio.value));
    }
    return panel;
}

function mostrarCierres() {
    const contenedor = document.getElementById('cierres-lista');
    contenedor.replaceChildren();
    try {
        const cierres = JSON.parse(localStorage.getItem(CLAVE_CIERRES) || '[]');
        for (const cierre of cierres.slice().reverse()) {
            const detalle = document.createElement('details');
            const titulo = document.createElement('summary');
            titulo.textContent = `${cierre.tipo} ${cierre.numero} · ${cierre.fecha} · ${cierre.cuentas.length} cuentas pagadas (simulación)`;
            const json = document.createElement('pre'); json.textContent = JSON.stringify(cierre, null, 2);
            detalle.append(titulo, json); contenedor.appendChild(detalle);
        }
        if (!cierres.length) contenedor.textContent = 'Todavía no hay operaciones cerradas.';
    } catch { contenedor.textContent = 'No se pudo leer el historial local.'; }
}

const USUARIOS_DEMO = [
    { usuario: 'admin', rol: 'administrador', nombre: 'Administrador' },
    { usuario: 'mesero1', rol: 'mesero', nombre: 'Mesero 1' },
    { usuario: 'mesero2', rol: 'mesero', nombre: 'Mesero 2' },
    { usuario: 'cocina', rol: 'estacion', nombre: 'Cocina', estacion: 'cocina' },
    { usuario: 'bar', rol: 'estacion', nombre: 'Bar', estacion: 'bar' },
    { usuario: 'auditor', rol: 'auditor', nombre: 'Auditor / Sistemas' }
];
let sesionActual = null;

function permite(accion, pedido = null, area = null) {
    if (!sesionActual) return false;
    if (sesionActual.rol === 'administrador') return true;
    if (accion === 'consulta') return sesionActual.rol === 'auditor' || (sesionActual.rol === 'mesero' && (!pedido || !pedido.mesero || pedido.mesero === sesionActual.nombre));
    if (accion === 'preparar') return sesionActual.rol === 'estacion' && sesionActual.estacion === area;
    if (accion === 'operar' || accion === 'retirar') return sesionActual.rol === 'mesero'
        && (!pedido || !pedido.mesero || pedido.mesero === sesionActual.nombre);
    return false;
}

function exigirPermiso(accion, pedido = null, area = null) {
    if (permite(accion, pedido, area)) return true;
    mostrarAviso('Tu rol no permite esta acción o esta mesa pertenece a otro mesero.', 'Acceso restringido', 'aviso');
    return false;
}

function pantallaPermitida(id) {
    if (id === 'login-screen') return true;
    if (!sesionActual) return false;
    if (sesionActual.rol === 'administrador') return true;
    if (sesionActual.rol === 'estacion') return id === `${sesionActual.estacion}-screen`;
    if (sesionActual.rol === 'auditor') return ['caja-screen', 'confirmacion-facturacion-screen'].includes(id);
    return !['configuracion-screen', 'meseros-screen', 'usuarios-screen'].includes(id);
}

function aplicarInterfazRol() {
    document.querySelectorAll('[data-roles]').forEach(elemento => {
        elemento.hidden = !elemento.dataset.roles.split(' ').includes(sesionActual?.rol);
    });
    document.querySelectorAll('button[onclick]').forEach(boton => {
        const match = boton.getAttribute('onclick').match(/showScreen\('([^']+)'\)/);
        if (match) boton.hidden = !pantallaPermitida(match[1]);
    });
    document.getElementById('mesero-activo').closest('label').hidden = sesionActual?.rol !== 'administrador';
    document.querySelector('.waiter-assignment').hidden = sesionActual?.rol !== 'administrador';
    if (sesionActual?.rol === 'mesero') {
        equipoMeseros.activo = sesionActual.nombre;
        renderizarSelectorMesero();
        filtroMisMesas = true;
        document.getElementById('filtro-mesas').value = 'mis';
    } else {
        filtroMisMesas = false;
        document.getElementById('filtro-mesas').value = 'todas';
    }
    mostrarMesas(); mostrarParaLlevar(); mostrarCocina(); mostrarBar(); mostrarCaja();
}

function abrirUsuariosDemo() {
    if (!exigirPermiso('administrar')) return;
    const lista = document.getElementById('usuarios-demo-lista');
    lista.replaceChildren();
    USUARIOS_DEMO.forEach(usuario => {
        const linea = document.createElement('p');
        linea.textContent = `${usuario.usuario} · ${usuario.nombre} · ${usuario.rol}${usuario.estacion ? ` (${usuario.estacion})` : ''}`;
        lista.appendChild(linea);
    });
    showScreen('usuarios-screen');
}

// Reducir el número de mesas a 9
const mesas = [
    { numero: 1, ocupada: false, terminada: false, cuentaPedida: false, nombresCuentas: {}, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 2, ocupada: false, terminada: false, cuentaPedida: false, nombresCuentas: {}, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 3, ocupada: false, terminada: false, cuentaPedida: false, nombresCuentas: {}, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 4, ocupada: false, terminada: false, cuentaPedida: false, nombresCuentas: {}, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 5, ocupada: false, terminada: false, cuentaPedida: false, nombresCuentas: {}, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 6, ocupada: false, terminada: false, cuentaPedida: false, nombresCuentas: {}, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 7, ocupada: false, terminada: false, cuentaPedida: false, nombresCuentas: {}, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 8, ocupada: false, terminada: false, cuentaPedida: false, nombresCuentas: {}, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 9, ocupada: false, terminada: false, cuentaPedida: false, nombresCuentas: {}, ordenes: [{ estado: 'nueva', items: [] }] }
];

let orden = [];
let ordenEnCocina = [];
let ordenEnBar = [];
let mesaSeleccionada = null;
let notaIndex = null;
let paraLlevarCounter = 1;
let paraLlevarOrdenes = [];
let ordenParaFacturar = null;
let cuentaIndex = 0; // Índice para la cuenta actual
let tiemposDePreparacion = []; // Array para almacenar tiempos de inicio de cada ítem

const CLAVE_ESTADO = 'comandas.estado.v1';
let almacenamientoDisponible = true;

function mostrarEstadoGuardado(mensaje) {
    const indicador = document.getElementById('estado-guardado');
    if (indicador) indicador.textContent = mensaje;
}

function guardarEstado() {
    if (!almacenamientoDisponible) return false;
    try {
        // La demo conserva los datos localmente para recuperar el flujo tras recargar.
        const sinFactura = pedido => pedido;
        localStorage.setItem(CLAVE_ESTADO, JSON.stringify({
            version: 1,
            mesas: mesas.map(sinFactura),
            paraLlevarOrdenes: paraLlevarOrdenes.map(sinFactura),
            paraLlevarCounter,
            tiemposDePreparacion
        }));
        mostrarEstadoGuardado('Pedidos guardados en este navegador');
        return true;
    } catch (error) {
        mostrarEstadoGuardado('No se pudo guardar. Mantén esta página abierta.');
        console.warn('No se pudo guardar el estado de Comandas.', error.name);
        return false;
    }
}

function restaurarEstado() {
    try {
        const contenido = localStorage.getItem(CLAVE_ESTADO);
        if (!contenido) return;
        const estado = JSON.parse(contenido);
        const pedidoValido = pedido => pedido && Number.isInteger(pedido.numero)
            && typeof pedido.ocupada === 'boolean' && typeof pedido.terminada === 'boolean'
            && typeof pedido.cuentaPedida === 'boolean'
            && pedido.nombresCuentas && typeof pedido.nombresCuentas === 'object'
            && Array.isArray(pedido.ordenes) && pedido.ordenes.every(grupo =>
                grupo && typeof grupo.estado === 'string' && Array.isArray(grupo.items)
                && grupo.items.every(item => item && typeof item.nombre === 'string'
                    && Number.isInteger(item.cantidad) && item.cantidad > 0
                    && Number.isInteger(item.cuenta) && item.cuenta > 0
                    && typeof item.nota === 'string'
                    && (item.retirados === undefined || (Number.isInteger(item.retirados)
                        && item.retirados >= 0 && item.retirados <= item.cantidad)))) ;
        if (estado.version !== 1 || !Array.isArray(estado.mesas)
            || estado.mesas.length !== mesas.length
            || !estado.mesas.every((mesa, index) => pedidoValido(mesa) && mesa.numero === index + 1)
            || !Array.isArray(estado.paraLlevarOrdenes) || !estado.paraLlevarOrdenes.every(pedidoValido)
            || !Number.isInteger(estado.paraLlevarCounter)
            || estado.paraLlevarCounter <= Math.max(0, ...estado.paraLlevarOrdenes.map(p => p.numero))
            || !Array.isArray(estado.tiemposDePreparacion)
            || !estado.tiemposDePreparacion.every(t => t && Number.isFinite(new Date(t.inicio).getTime()))) {
            throw new Error('Formato de datos guardados inválido');
        }
        // JSON separa las referencias compartidas. Retiramos los ítems enviados
        // del borrador para que no vuelvan a aparecer como pedidos nuevos.
        const reconstruir = pedido => ({ ...pedido, ordenes: pedido.ordenes.map(grupo =>
            grupo.estado === 'nueva'
                ? { ...grupo, items: grupo.items.filter(item => !item.enCocina && !item.enBar) }
                : grupo) });
        mesas.splice(0, mesas.length, ...estado.mesas.map(reconstruir));
        paraLlevarOrdenes = estado.paraLlevarOrdenes.map(reconstruir);
        paraLlevarCounter = estado.paraLlevarCounter;
        tiemposDePreparacion = estado.tiemposDePreparacion.map(t => ({ ...t, inicio: new Date(t.inicio) }));
        mostrarEstadoGuardado('Pedidos recuperados de este navegador');
    } catch (error) {
        // Conservamos el contenido anterior para evitar sobrescribir datos recuperables.
        almacenamientoDisponible = false;
        mostrarEstadoGuardado('No se pudieron recuperar los pedidos. Los datos anteriores se conservaron.');
        console.warn('No se pudo recuperar el estado de Comandas.', error.name);
    }
}

// Función para manejar el inicio de sesión
let focoAntesDelAviso = null;

function mostrarAviso(mensaje, titulo = 'Listo', tipo = 'exito') {
    const dialogo = document.getElementById('aviso-dialogo');
    if (!dialogo.open) focoAntesDelAviso = document.activeElement;
    document.getElementById('aviso-titulo').textContent = titulo;
    document.getElementById('aviso-mensaje').textContent = mensaje;
    document.getElementById('aviso-icono').textContent = tipo === 'exito' ? '✓' : '!';
    dialogo.dataset.tipo = tipo;
    if (!dialogo.open) dialogo.showModal();
    document.getElementById('aviso-aceptar').focus();
}

const CLAVE_ACCESO = 'comandas.ultimoAcceso.v1';

function recordarAcceso(usuario, contrasena) {
    try {
        localStorage.setItem(CLAVE_ACCESO, JSON.stringify({ usuario, contrasena }));
    } catch {
        console.warn('No se pudo recordar el acceso en este navegador.');
    }
}

function recuperarAcceso() {
    try {
        const acceso = JSON.parse(localStorage.getItem(CLAVE_ACCESO));
        if (acceso && typeof acceso.usuario === 'string' && typeof acceso.contrasena === 'string') {
            document.getElementById('usuario').value = acceso.usuario;
            document.getElementById('contrasena').value = acceso.contrasena;
        }
    } catch {
        console.warn('No se pudo recuperar el último acceso.');
    }
}

let usuarioLogueado = null;

function abrirMenu() {
    if (!usuarioLogueado) return;
    document.getElementById('user-menu').open = false;
    const menu = document.getElementById('app-menu');
    if (!menu.open) menu.showModal();
    document.getElementById('abrir-menu').setAttribute('aria-expanded', 'true');
    menu.querySelector('button').focus();
}

function cerrarMenu() {
    const menu = document.getElementById('app-menu');
    if (menu.open) menu.close();
}

function cerrarSesion() {
    guardarEstado();
    cerrarMenu();
    document.getElementById('user-menu').open = false;
    const aviso = document.getElementById('aviso-dialogo');
    if (aviso.open) aviso.close();
    usuarioLogueado = null;
    sesionActual = null;
    mesaSeleccionada = null;
    ordenParaFacturar = null;
    orden = [];
    ordenEnCocina = [];
    ordenEnBar = [];
    document.getElementById('lsoft-json').textContent = '';
    showScreen('login-screen');
    recuperarAcceso();
    document.getElementById('usuario').focus();
}

function iniciarSesion() {
    const usuario = document.getElementById('usuario').value.trim();
    const contrasena = document.getElementById('contrasena').value.trim();

    if (usuario === '' || contrasena === '') {
        mostrarAviso('Por favor, ingresa el usuario y la contraseña.', 'Completa tus datos', 'aviso');
        return;
    }

    // Simulamos una verificación básica de usuario y contraseña
    const perfil = USUARIOS_DEMO.find(u => u.usuario === usuario);
    if (perfil && contrasena === '1234') {
        sesionActual = { ...perfil };
        usuarioLogueado = usuario;
        document.getElementById('user-name').textContent = `${usuario} · ${perfil.rol === 'estacion' ? perfil.nombre : perfil.rol}`;
        document.getElementById('user-avatar').textContent = usuario[0].toUpperCase();
        recordarAcceso(usuario, contrasena);
        aplicarInterfazRol();
        showScreen(perfil.rol === 'estacion' ? `${perfil.estacion}-screen` : perfil.rol === 'auditor' ? 'caja-screen' : 'seleccion-mesas-screen');
        console.log("Inicio de sesión exitoso"); // Debug
    } else {
        mostrarAviso('Usuario o contraseña incorrectos.', 'Revisa el acceso', 'aviso');
        console.log("Fallo en el inicio de sesión"); // Debug
    }
}

// Función para mostrar la pantalla deseada
function showScreen(screenId) {
    if (!pantallaPermitida(screenId)) { mostrarAviso('Esta pantalla no está disponible para tu rol.', 'Acceso restringido', 'aviso'); return; }
    cerrarDetalleOrden();
    document.getElementById('app-topbar').hidden = screenId === 'login-screen' || !usuarioLogueado;
    console.log(`Intentando mostrar pantalla: ${screenId}`); // Debug
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => {
        screen.style.display = 'none';
        screen.classList.remove('active');
    });
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.style.display = 'block';
        targetScreen.classList.add('active');
        console.log(`Pantalla actual: ${screenId}`); // Debug
    } else {
        console.error(`Screen with id ${screenId} not found`);
    }
}

// Función para mostrar la lista de órdenes pendientes en caja
function mostrarCaja() {
    const lista = document.getElementById('caja-list');
    lista.replaceChildren();
    [...mesas, ...paraLlevarOrdenes].forEach(pedido => {
        if (sesionActual?.rol === 'mesero' && pedido.mesero !== sesionActual.nombre) return;
        cuentasParaFacturar(pedido).forEach(cuenta => {
            const registro = pedido.integracion?.[cuenta];
            const error = pedido.erroresLSoft?.[cuenta];
            if (!registro && !error) return;
            const boton = document.createElement('button');
            boton.type = 'button'; boton.className = 'caja-item lsoft-status-card';
            const titulo = document.createElement('strong');
            titulo.textContent = `${mesas.includes(pedido) ? 'Mesa' : 'Para Llevar'} ${pedido.numero} · Cuenta ${cuenta}`;
            const estado = document.createElement('span');
            estado.textContent = registro ? `${registro.pedidoId} · ${registro.estado === 'pagado' ? 'Pagada' : 'Pendiente de pago'} (simulado)` : 'Error de envío · Reintentar';
            boton.append(titulo, estado);
            boton.onclick = () => seleccionarParaFacturacion(pedido);
            lista.appendChild(boton);
        });
    });
    if (!lista.children.length) lista.textContent = 'Todavía no hay cuentas enviadas a LSoft ni errores pendientes.';
}

// Función para mostrar las mesas
function actualizarPendientes() {
    ['cocina', 'bar'].forEach(area => {
        const cantidad = [...mesas, ...paraLlevarOrdenes].reduce((total, pedido) =>
            total + pedido.ordenes
                .filter(grupo => grupo.estado === `en ${area}`)
                .reduce((subtotal, grupo) => subtotal + grupo.items
                    .filter(item => item[area === 'cocina' ? 'enCocina' : 'enBar'] !== 'terminado')
                    .reduce((unidades, item) => unidades + item.cantidad, 0), 0), 0);
        const indicador = document.getElementById(`pendientes-${area}`);
        if (indicador) {
            indicador.textContent = `· ${cantidad} ${cantidad === 1 ? 'pendiente' : 'pendientes'}`;
            indicador.classList.toggle('has-pending', cantidad > 0);
        }
        const listos = [...mesas, ...paraLlevarOrdenes].flatMap(itemsEnviados)
            .filter(entrada => entrada.area === area)
            .reduce((total, { item }) => total + (item[area === 'cocina' ? 'enCocina' : 'enBar'] === 'terminado'
                ? item.cantidad - (item.retirados || 0) : 0), 0);
        const retiro = document.getElementById(`listos-${area}`);
        if (retiro) retiro.textContent = `· ${listos} por retirar`;
    });
}

function itemsEnviados(pedido) {
    return pedido.ordenes.flatMap((grupo, grupoIndex) =>
        ['en cocina', 'en bar'].includes(grupo.estado)
            ? grupo.items.map((item, itemIndex) => ({ item, grupoIndex, itemIndex,
                area: grupo.estado === 'en cocina' ? 'cocina' : 'bar' })) : []);
}

function resumenPedido(pedido) {
    const resumen = { preparar: 0, retirar: 0, retirados: 0, adicionalesPreparar: 0, adicionalesRetirar: 0 };
    itemsEnviados(pedido).forEach(({ item, area }) => {
        const retirados = item.retirados || 0;
        const restantes = item.cantidad - retirados;
        const listo = item[area === 'cocina' ? 'enCocina' : 'enBar'] === 'terminado';
        resumen.retirados += retirados;
        resumen[listo ? 'retirar' : 'preparar'] += restantes;
        if (item.adicional) resumen[listo ? 'adicionalesRetirar' : 'adicionalesPreparar'] += restantes;
    });
    return resumen;
}

function tarjetaPedido(pedido, nombre, seleccionar) {
    const r = resumenPedido(pedido);
    const boton = document.createElement('button');
    boton.type = 'button';
    const estado = !pedido.ocupada ? 'libre' : r.retirar > 0 ? 'por-retirar'
        : r.preparar > 0 ? 'en-preparacion' : 'retirada';
    boton.className = `mesa ${pedido.ocupada ? 'ocupada ' : ''}${estado}`;
    const titulo = document.createElement('strong');
    titulo.textContent = nombre;
    boton.appendChild(titulo);
    const mesero = document.createElement('small');
    mesero.textContent = pedido.mesero || 'Sin asignar';
    boton.appendChild(mesero);
    if (pedido.mesero) {
        const badge = document.createElement('span');
        badge.className = 'waiter-badge';
        badge.textContent = pedido.mesero.split(/\s+/).slice(0, 2).map(n => [...n][0]).join('').toUpperCase();
        badge.setAttribute('aria-hidden', 'true');
        boton.appendChild(badge);
    }
    const detalle = document.createElement('small');
    detalle.textContent = !pedido.ocupada ? 'Libre' :
        r.preparar || r.retirar ? `${r.retirar} por retirar · ${r.preparar} en preparación` : 'Todo retirado';
    boton.appendChild(detalle);
    [r.adicionalesRetirar ? 'Adicionales listos' : '',
        r.adicionalesPreparar ? 'Adicionales en preparación' : '',
        pedido.cuentaPedida ? 'Cuenta pedida' : ''].filter(Boolean).forEach(texto => {
        const etiqueta = document.createElement('small');
        etiqueta.className = 'table-label';
        etiqueta.textContent = texto;
        boton.appendChild(etiqueta);
    });
    boton.onclick = seleccionar;
    return boton;
}

function mostrarMesas() {
    actualizarPendientes();
    const contenedor = document.getElementById('mesas');
    contenedor.replaceChildren(...mesas.filter(visibleParaMesero).map(mesa =>
        tarjetaPedido(mesa, `Mesa ${mesa.numero}`, () => seleccionarMesa(mesa.numero))));
    actualizarRetiroSeleccionado();
}

function mostrarParaLlevar() {
    const contenedor = document.getElementById('para-llevar');
    contenedor.replaceChildren(...paraLlevarOrdenes.filter(visibleParaMesero).map(pedido =>
        tarjetaPedido(pedido, `Para Llevar ${pedido.numero}`, () => seleccionarOrdenParaLlevar(pedido.numero))));
}

function actualizarRetiroSeleccionado() {
    const boton = document.getElementById('retirar-listos-mesa');
    if (!boton || !mesaSeleccionada) return;
    boton.hidden = !permite('retirar', mesaSeleccionada);
    const r = resumenPedido(mesaSeleccionada);
    boton.disabled = r.retirar === 0;
    boton.textContent = r.retirar ? `Retirar todo lo listo (${r.retirar})` : 'No hay productos listos para retirar';
    boton.onclick = () => retirarTodoListo(mesas.includes(mesaSeleccionada) ? 'mesa' : 'llevar', mesaSeleccionada.numero);
}

// Función para seleccionar una mesa
function seleccionarMesa(numero) {
    console.log(`Seleccionando mesa: ${numero}`); // Debug
    const elegida = mesas.find(m => m.numero === numero);
    if (!exigirPermiso('operar', elegida)) return;
    mesaSeleccionada = elegida;
    asignarAlAbrir(mesaSeleccionada);
    document.getElementById('orden-tipo').textContent = "Mesa";
    document.getElementById('orden-numero').textContent = mesaSeleccionada.numero;
    document.getElementById('cuentas').value = 1; // Restablecer el número de cuenta a 1
    document.getElementById('nombre-cuenta').value = ''; // Restablecer el nombre de la cuenta a vacío
    ordenEnCocina = mesaSeleccionada.ordenes.filter(o => o.estado === 'en cocina').flatMap(o => o.items);
    ordenEnBar = mesaSeleccionada.ordenes.filter(o => o.estado === 'en bar').flatMap(o => o.items);
    orden = mesaSeleccionada.ordenes.find(o => o.estado === 'nueva')?.items || [];
    actualizarOrden();
    actualizarRetiroSeleccionado();
    showProducts(categoriaSeleccionada);
    showScreen('toma-ordenes-screen');
}

// Función para seleccionar una orden para llevar
function seleccionarOrdenParaLlevar(numero) {
    console.log(`Seleccionando orden para llevar: ${numero}`); // Debug
    const elegida = paraLlevarOrdenes.find(o => o.numero === numero);
    if (!exigirPermiso('operar', elegida)) return;
    mesaSeleccionada = elegida;
    asignarAlAbrir(mesaSeleccionada);
    document.getElementById('orden-tipo').textContent = "Para Llevar";
    document.getElementById('orden-numero').textContent = mesaSeleccionada.numero;
    document.getElementById('cuentas').value = 1; // Restablecer el número de cuenta a 1
    document.getElementById('nombre-cuenta').value = ''; // Restablecer el nombre de la cuenta a vacío
    ordenEnCocina = mesaSeleccionada.ordenes.filter(o => o.estado === 'en cocina').flatMap(o => o.items);
    ordenEnBar = mesaSeleccionada.ordenes.filter(o => o.estado === 'en bar').flatMap(o => o.items);
    orden = mesaSeleccionada.ordenes.find(o => o.estado === 'nueva')?.items || [];
    actualizarOrden();
    actualizarRetiroSeleccionado();
    showProducts(categoriaSeleccionada);
    showScreen('toma-ordenes-screen');
}

// Función para crear una nueva orden para llevar
function crearParaLlevar() {
    if (!exigirPermiso('operar')) return;
    const nuevaOrden = {
        numero: paraLlevarCounter,
        ocupada: false,
        terminada: false,
        cuentaPedida: false,
        nombresCuentas: {},
        ordenes: [{ estado: 'nueva', items: [] }]
    };
    paraLlevarCounter += 1;
    nuevaOrden.mesero = equipoMeseros.activo;
    paraLlevarOrdenes.push(nuevaOrden);
    mostrarParaLlevar();
    console.log(`Creada nueva orden para llevar: ${nuevaOrden.numero}`); // Debug
    guardarEstado();
}

let categoriaSeleccionada = 'entradas';
const nombresCategorias = {
    entradas: 'Entradas', platos: 'Platos fuertes', postres: 'Postres',
    bebidas: 'Bebidas', bebidasAlcoolicas: 'Bebidas alcohólicas', adicionales: 'Adicionales'
};

function actualizarCantidadesProductos() {
    const cuenta = Number(document.getElementById('cuentas').value);
    document.getElementById('menu-cuenta').textContent = `Añadiendo a Cuenta ${cuenta}`;
    document.querySelectorAll('#products .product').forEach(tarjeta => {
        const cantidad = orden.filter(item => item.nombre === tarjeta.dataset.producto
            && item.cuenta === cuenta && !item.enCocina && !item.enBar)
            .reduce((total, item) => total + item.cantidad, 0);
        tarjeta.querySelector('.product-quantity').textContent = cantidad ? `${cantidad} en esta cuenta` : '+ Añadir';
        tarjeta.classList.toggle('product-selected', cantidad > 0);
        tarjeta.setAttribute('aria-label', `${tarjeta.dataset.producto}, ${cantidad} en el borrador de cuenta ${cuenta}. Añadir uno`);
    });
}

function showProducts(categoria) {
    if (!productos[categoria]) return;
    categoriaSeleccionada = categoria;
    document.getElementById('buscar-producto').value = '';
    renderizarMenu();
}

function renderizarMenu() {
    const categoria = categoriaSeleccionada;
    const consulta = document.getElementById('buscar-producto').value.trim();
    const normalizar = texto => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const coincidencias = consulta
        ? [...new Map(Object.entries(productos).flatMap(([grupo, nombres]) =>
            nombres.filter(nombre => normalizar(nombre).includes(normalizar(consulta)))
                .map(nombre => [nombre, { nombre, grupo }]))).values()]
        : productos[categoria].map(nombre => ({ nombre, grupo: categoria }));
    document.querySelectorAll('#categories .category').forEach(boton => {
        const seleccionada = !consulta && boton.dataset.categoria === categoria;
        boton.classList.toggle('category-active', seleccionada);
        boton.setAttribute('aria-pressed', String(seleccionada));
    });
    document.getElementById('menu-titulo').textContent = consulta ? 'Resultados en todo el menú' : nombresCategorias[categoria];
    document.getElementById('buscar-resultados').textContent = consulta
        ? `${coincidencias.length} ${coincidencias.length === 1 ? 'producto encontrado' : 'productos encontrados'}` : '';
    document.getElementById('limpiar-busqueda').hidden = !consulta;
    const contenedor = document.getElementById('products');
    contenedor.replaceChildren(...coincidencias.map(({ nombre: producto, grupo }) => {
        const tarjeta = document.createElement('button');
        tarjeta.type = 'button';
        tarjeta.className = `product ${grupo}`;
        tarjeta.dataset.producto = producto;
        const nombre = document.createElement('span');
        nombre.className = 'product-name';
        nombre.textContent = producto;
        const cantidad = document.createElement('span');
        cantidad.className = 'product-quantity';
        const precio = document.createElement('strong');
        precio.className = 'product-price';
        const tarifa = tarifaProducto(producto);
        precio.textContent = `${dinero(tarifa.precio)}${tarifa.incluidos ? '' : ' + cargos'}`;
        tarjeta.append(nombre, precio, cantidad);
        if (consulta) {
            const etiqueta = document.createElement('small');
            etiqueta.textContent = nombresCategorias[grupo];
            tarjeta.appendChild(etiqueta);
        }
        tarjeta.onclick = () => agregarProducto(producto);
        return tarjeta;
    }));
    if (!coincidencias.length) {
        const vacio = document.createElement('p');
        vacio.className = 'search-empty';
        vacio.textContent = 'No encontramos productos. Prueba con otro nombre.';
        contenedor.appendChild(vacio);
    }
    actualizarCantidadesProductos();
}

// Compatibilidad con llamadas anteriores: las categorías ya no se ocultan.
function showCategories() { showProducts(categoriaSeleccionada); }

// Función para agregar un producto a la orden
function agregarProducto(producto) {
    if (!exigirPermiso('operar', mesaSeleccionada)) return;
    const cuenta = Number(document.getElementById('cuentas').value);
    if (!Number.isInteger(cuenta) || cuenta < 1) {
        mostrarAviso('Selecciona una cuenta válida antes de añadir productos.', 'Revisa la cuenta', 'aviso');
        return;
    }
    console.log(`Agregando producto: ${producto} a la cuenta: ${cuenta}`); // Debug

    // Buscar si el producto ya está en la orden para esta cuenta
    const tarifa = tarifaProducto(producto);
    const index = orden.findIndex(item => item.nombre === producto && item.cuenta === cuenta && !item.enCocina && !item.enBar
        && JSON.stringify(item.tarifa) === JSON.stringify(tarifa));

    if (index > -1) {
        // Si el producto ya está, aumentamos la cantidad
        orden[index].cantidad += 1;
    } else {
        // Si no está, lo añadimos a la orden
        orden.push({ nombre: producto, cantidad: 1, cuenta: cuenta, enCocina: false, enBar: false, nota: '', tarifa });
    }

    // Guardar tiempo de inicio para el producto si es la primera vez que se añade
    if (!tiemposDePreparacion.some(t => t.nombre === producto && t.cuenta === cuenta)) {
        tiemposDePreparacion.push({ nombre: producto, cuenta: cuenta, inicio: new Date() });
    }

    actualizarOrden();
    guardarEstado();
}

// Función para disminuir la cantidad de un producto en la orden
function disminuirCantidad(producto, cuenta) {
    if (!exigirPermiso('operar', mesaSeleccionada)) return;
    console.log(`Disminuyendo cantidad de producto: ${producto} para la cuenta: ${cuenta}`); // Debug

    // Buscar el producto en la orden
    const index = orden.findIndex(item => item.nombre === producto && item.cuenta === cuenta && !item.enCocina && !item.enBar);

    if (index > -1) {
        // Reducimos la cantidad
        orden[index].cantidad -= 1;
        // Si la cantidad llega a 0, removemos el producto de la orden
        if (orden[index].cantidad === 0) {
            orden.splice(index, 1);
        }
    }

    actualizarOrden();
    guardarEstado();
}

// Función para abrir el modal para añadir notas a un producto
function abrirModalNota(index) {
    if (!exigirPermiso('operar', mesaSeleccionada)) return;
    notaIndex = index;
    console.log(`Abriendo modal para añadir nota al producto en el índice: ${index}`); // Debug
    document.getElementById('nota-texto').value = orden[index].nota || '';
    const panel = document.getElementById('detalle-dialogo');
    if (panel.open) panel.append(document.getElementById('nota-modal'));
    document.getElementById('nota-modal').style.display = 'block';
    document.getElementById('nota-texto').focus();
}

// Función para cerrar el modal de notas
function cerrarModal() {
    console.log("Cerrando modal de notas"); // Debug
    document.getElementById('nota-modal').style.display = 'none';
    document.body.append(document.getElementById('nota-modal'));
}

// Función para guardar la nota del modal
function guardarNota() {
    if (!exigirPermiso('operar', mesaSeleccionada)) return;
    const nota = document.getElementById('nota-texto').value;
    if (notaIndex !== null) {
        orden[notaIndex].nota = nota;
        console.log(`Guardando nota para el producto en el índice: ${notaIndex}`); // Debug
        actualizarOrden();
    }
    cerrarModal();
    guardarEstado();
}

function alternarBusqueda() {
    const campo = document.getElementById('buscar-producto');
    const contenedor = document.getElementById('menu-search');
    if (!contenedor.hidden && campo.value.trim()) { campo.focus(); return; }
    contenedor.hidden = !contenedor.hidden;
    document.getElementById('abrir-busqueda').setAttribute('aria-expanded', String(!contenedor.hidden));
    if (!contenedor.hidden) campo.focus();
}

function abrirDetalleOrden() {
    if (window.innerWidth >= 900) return;
    const dialogo = document.getElementById('detalle-dialogo');
    dialogo.append(document.getElementById('order-summary'));
    dialogo.showModal();
}

function cerrarDetalleOrden() {
    const dialogo = document.getElementById('detalle-dialogo');
    if (dialogo?.open) dialogo.close();
    if (dialogo?.contains(document.getElementById('nota-modal'))) cerrarModal();
    const detalle = document.getElementById('order-summary');
    if (detalle && dialogo?.contains(detalle)) {
        document.querySelector('#toma-ordenes-screen .order-content').append(detalle);
    }
}

// Función para actualizar la lista de la orden
function actualizarOrden() {
    const ordenList = document.getElementById('orden-list');
    ordenList.innerHTML = ''; // Limpiar la lista de la orden

    // Mostrar los items en cocina
    ordenEnCocina.forEach(item => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            ${item.nombre} - ${item.cantidad}
            <span class="en-cocina">(En cocina)</span>
        `;
        ordenList.appendChild(listItem);
    });

    // Mostrar los items en bar
    ordenEnBar.forEach(item => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            ${item.nombre} - ${item.cantidad}
            <span class="en-bar">(En bar)</span>
        `;
        ordenList.appendChild(listItem);
    });

    // Mostrar los items que aún no están en preparación
    orden.filter(item => !item.enCocina && !item.enBar).forEach((item, index) => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            <div>${item.nombre} - ${item.cantidad}${item.cuenta !== 1 ? ` (Cuenta ${item.cuenta})` : ''}</div>
            <div class="quantity-controls">
                <button onclick="disminuirCantidad('${item.nombre}', ${item.cuenta})">-</button>
                <button onclick="agregarProducto('${item.nombre}')">+</button>
                <button onclick="abrirModalNota(${index})">📝</button>
            </div>
        `;
        ordenList.appendChild(listItem);
    });

    // Hacer scroll al final de la lista para mostrar el último item añadido
    ordenList.scrollTop = ordenList.scrollHeight;
    actualizarCantidadesProductos();
    const items = [...ordenEnCocina, ...ordenEnBar, ...orden.filter(item => !item.enCocina && !item.enBar)];
    const cantidad = items.reduce((total, item) => total + item.cantidad, 0);
    const total = items.reduce((total, item) => total + calcularImportes(item.tarifa || tarifaProducto(item.nombre), item.cantidad).total, 0);
    document.getElementById('resumen-cantidad').textContent = cantidad ? `${cantidad} ${cantidad === 1 ? 'artículo' : 'artículos'} · Todas las cuentas` : 'Orden vacía';
    document.getElementById('resumen-total').textContent = dinero(total);
    document.getElementById('detalle-total').textContent = dinero(total);
    if (!cantidad) ordenList.innerHTML = '<li class="order-empty">Añade productos para empezar.</li>';
    console.log("Orden actualizada", orden); // Debug
}

// Función para confirmar la orden
function confirmarOrden() {
    if (!exigirPermiso('operar', mesaSeleccionada)) return;
    const confirmacionList = document.getElementById('confirmacion-list');
    confirmacionList.innerHTML = ''; // Limpiar la lista de confirmación

    // Mostrar los items en cocina
    ordenEnCocina.forEach(item => {
        const listItem = document.createElement('li');
        listItem.style.marginBottom = '10px'; // Asegurar separación entre items
        listItem.innerHTML = `
            <div>${item.nombre} - ${item.cantidad} (En cocina)</div>
        `;
        confirmacionList.appendChild(listItem);
    });

    // Mostrar los items en bar
    ordenEnBar.forEach(item => {
        const listItem = document.createElement('li');
        listItem.style.marginBottom = '10px'; // Asegurar separación entre items
        listItem.innerHTML = `
            <div>${item.nombre} - ${item.cantidad} (En bar)</div>
        `;
        confirmacionList.appendChild(listItem);
    });

    // Mostrar los items que aún no están en preparación
    orden.filter(item => !item.enCocina && !item.enBar).forEach(item => {
        const listItem = document.createElement('li');
        listItem.style.marginBottom = '10px'; // Asegurar separación entre items
        listItem.innerHTML = `
            <div>${item.nombre} - ${item.cantidad}${item.cuenta !== 1 ? ` (Cuenta ${item.cuenta})` : ''}</div>
        `;
        confirmacionList.appendChild(listItem);
    });

    showScreen('confirmacion-screen');
    console.log("Confirmación de orden"); // Debug
}

// Función para enviar la orden a preparación (cocina o bar)
function enviarCocina() {
    if (!exigirPermiso('operar', mesaSeleccionada)) return;
    if (Object.keys(mesaSeleccionada?.integracion || {}).length) {
        mostrarAviso('Este pedido ya se envió a LSoft. Cierra su cobro antes de enviar otra ronda.', 'Pedido enviado', 'aviso'); return;
    }
    // Encontrar la orden nueva
    let ordenNueva = mesaSeleccionada.ordenes.find(o => o.estado === 'nueva');
    if (!ordenNueva) {
        ordenNueva = { estado: 'nueva', items: [] };
        mesaSeleccionada.ordenes.push(ordenNueva);
    }

    // Separar los ítems para bar y cocina
    const itemsParaEnviar = orden.filter(item => !item.enCocina && !item.enBar);

    const esAdicional = itemsEnviados(mesaSeleccionada).length > 0;
    itemsParaEnviar.forEach(item => {
        item.adicional = esAdicional;
        item.retirados = 0;
        if (productos.bebidasAlcoolicas.includes(item.nombre) || productos.bebidas.includes(item.nombre)) {
            item.enBar = true; // Marcar como ítem de bar
        } else {
            item.enCocina = true; // Marcar como ítem de cocina
        }
    });

    if (itemsParaEnviar.length > 0) {
        if (itemsParaEnviar.some(item => item.enCocina)) {
            mesaSeleccionada.ordenes.push({ estado: 'en cocina', items: itemsParaEnviar.filter(item => item.enCocina) });
        }
        if (itemsParaEnviar.some(item => item.enBar)) {
            mesaSeleccionada.ordenes.push({ estado: 'en bar', items: itemsParaEnviar.filter(item => item.enBar) });
        }
    }

    if (itemsParaEnviar.length === 0) {
        mostrarAviso('Añade productos nuevos antes de enviar.', 'Sin productos nuevos', 'aviso');
        return;
    }
    ordenNueva.items = [];
    orden = ordenNueva.items;
    mesaSeleccionada.terminada = false;
    mesaSeleccionada.ocupada = true; // Marcar la mesa como ocupada
    mostrarMesas();
    mostrarParaLlevar();
    mostrarCocina();
    mostrarBar();
    showScreen('seleccion-mesas-screen');
    mostrarAviso('Los alimentos se enviaron a Cocina y las bebidas al Bar.', 'Orden enviada');
    console.log(`Orden enviada a cocina/bar para Mesa/Para Llevar ${mesaSeleccionada.numero}`); // Debug
    guardarEstado();
}

// Función para cancelar la orden y volver a la pantalla de selección de mesas
function cancelarOrden() {
    showScreen('seleccion-mesas-screen');
    console.log("Orden cancelada, volviendo a selección de mesas"); // Debug
}

// Función para pedir la cuenta y mostrar la pantalla de facturación
function pedirCuenta() {
    if (!exigirPermiso('operar', mesaSeleccionada)) return;
    if (!mesaSeleccionada || !cuentasParaFacturar(mesaSeleccionada).length) {
        mostrarAviso('Esta mesa todavía no tiene consumo enviado a preparación.', 'Sin consumo', 'aviso');
        return;
    }
    console.log(`Intentando pedir cuenta para mesa: ${mesaSeleccionada.numero}, Estado actual: cuentaPedida=${mesaSeleccionada.cuentaPedida}`); // Debug

    if (mesaSeleccionada) {
        mesaSeleccionada.cuentaPedida = true; // Cambiar el estado de cuentaPedida
        console.log(`Cuenta pedida para mesa: ${mesaSeleccionada.numero}, Estado nuevo: cuentaPedida=${mesaSeleccionada.cuentaPedida}`); // Debug

        ordenParaFacturar = mesaSeleccionada; // Guardar la mesa seleccionada para facturación
        const pendientes = cuentasParaFacturar(ordenParaFacturar).findIndex(c => !ordenParaFacturar.integracion?.[c]);
        cuentaIndex = Math.max(0, pendientes);
        pedirDatosFacturaPorCuenta(); // Pedir datos para la primera cuenta
    } else {
        console.log(`La cuenta ya fue pedida para mesa: ${mesaSeleccionada.numero}`); // Debug
    }
    guardarEstado();
}

// Función para seleccionar una orden para facturación
function seleccionarParaFacturacion(pedido) {
    if (!exigirPermiso('consulta', pedido)) return;
    ordenParaFacturar = pedido;
    document.getElementById('factura-final-info').textContent =
        `${mesas.includes(pedido) ? 'Mesa' : 'Para Llevar'} ${pedido.numero}`;
    const lista = document.getElementById('factura-final-list');
    lista.replaceChildren();
    cuentasParaFacturar(pedido).forEach(cuenta => {
        const titulo = document.createElement('h3');
        titulo.textContent = `Cuenta ${cuenta}: ${pedido.nombresCuentas[cuenta] || 'Sin nombre'}`;
        const datos = pedido.factura?.[cuenta];
        const detalle = document.createElement('p');
        detalle.textContent = datos ?
            `${datos.nombreCompleto} · ${datos.cedula} · ${datos.direccion} · ${datos.telefono} · ${datos.correo} · Propina voluntaria: ${(datos.propina || 0).toFixed(2)}`
            : 'Datos de facturación pendientes';
        lista.append(titulo, tablaConsumo(pedido, cuenta), detalle, controlesLSoft(cuenta));
    });
    document.getElementById('lsoft-json').textContent = '';
    document.getElementById('lsoft-json-detalle').open = false;
    const cuentas = cuentasParaFacturar(pedido);
    document.getElementById('cerrar-mesa').hidden = !permite('administrar');
    document.getElementById('cerrar-mesa').disabled = !cuentas.length || !cuentas.every(c => pedido.integracion?.[c]?.estado === 'pagado');
    showScreen('confirmacion-facturacion-screen');
}

function tablaConsumo(pedido, cuenta, propina = pedido.factura?.[cuenta]?.propina || 0) {
    const tabla = document.createElement('table');
    tabla.className = 'consumption-table';
    const encabezado = document.createElement('thead');
    encabezado.innerHTML = '<tr><th scope="col">Producto</th><th scope="col">Cant.</th><th scope="col">Unitario final</th><th scope="col">Importe</th></tr>';
    const cuerpo = document.createElement('tbody');
    itemsEnviados(pedido).filter(({ item }) => String(item.cuenta) === String(cuenta)).forEach(({ item }) => {
        const tarifa = item.tarifa || tarifaProducto(item.nombre);
        const fila = document.createElement('tr');
        for (const valor of [item.nombre, item.cantidad, dinero(calcularImportes(tarifa).total), dinero(calcularImportes(tarifa, item.cantidad).total)]) {
            const celda = document.createElement('td'); celda.textContent = valor; fila.appendChild(celda);
        }
        cuerpo.appendChild(fila);
    });
    const pie = document.createElement('tfoot');
    const totales = totalesCuenta(pedido, cuenta);
    for (const [texto, valor] of [['Consumo base', totales.base], ['IVA (sin gravar servicio)', totales.iva],
        ['Servicio', totales.servicio], ['Total consumo', totales.total], ['Propina voluntaria', centavos(propina)],
        ['Total a pagar', totales.total + centavos(propina)]]) {
        const fila = document.createElement('tr');
        const etiqueta = document.createElement('th'); etiqueta.colSpan = 3; etiqueta.scope = 'row'; etiqueta.textContent = texto;
        const importe = document.createElement('td'); importe.textContent = dinero(valor); fila.append(etiqueta, importe); pie.appendChild(fila);
    }
    tabla.append(encabezado, cuerpo, pie);
    return tabla;
}

function actualizarTotalPrecuenta() {
    if (!ordenParaFacturar) return;
    const cuenta = cuentasParaFacturar(ordenParaFacturar)[cuentaIndex];
    if (!cuenta) return;
    const valor = Number(document.getElementById('propina').value);
    const propina = Number.isFinite(valor) && valor >= 0 ? valor : 0;
    document.getElementById('precuenta-consumo').replaceChildren(tablaConsumo(ordenParaFacturar, cuenta, propina));
}

function imprimirPrecuenta() {
    if (!ordenParaFacturar) return;
    const cuenta = cuentasParaFacturar(ordenParaFacturar)[cuentaIndex];
    if (!cuenta) return;
    const hoja = document.getElementById('precuenta-impresion');
    hoja.replaceChildren();
    const titulo = document.createElement('h1');
    titulo.textContent = 'Comandas · Precuenta';
    const referencia = document.createElement('p');
    referencia.textContent = document.getElementById('factura-info').textContent;
    hoja.append(titulo, referencia, tablaConsumo(ordenParaFacturar, cuenta, Math.max(0, Number(document.getElementById('propina').value) || 0)));
    for (const [id, nombre] of [['cedula', 'Cédula/RUC'], ['nombre-completo', 'Nombre completo'],
        ['direccion', 'Dirección'], ['telefono', 'Teléfono'], ['correo', 'Correo electrónico'],
        ['propina', 'Propina voluntaria (importe)']]) {
        const linea = document.createElement('p');
        linea.textContent = `${nombre}: ${document.getElementById(id).value.trim() || '________________________________'}`;
        hoja.appendChild(linea);
    }
    const aviso = document.createElement('p');
    aviso.textContent = 'IVA calculado sobre consumo base, sin gravar servicio. Propina voluntaria independiente. Documento de demostración, no válido como factura fiscal.';
    hoja.appendChild(aviso);
    window.print();
}

// Función para pedir datos de facturación por cuenta
function cuentasParaFacturar(pedido) {
    return [...new Set(itemsEnviados(pedido).map(({ item }) => String(item.cuenta)))]
        .sort((a, b) => Number(a) - Number(b));
}

function pedirDatosFacturaPorCuenta(omitirEnviadas = false) {
    const cuentas = cuentasParaFacturar(ordenParaFacturar);
    if (omitirEnviadas) {
        while (cuentaIndex < cuentas.length && ordenParaFacturar.integracion?.[cuentas[cuentaIndex]]) cuentaIndex++;
    }
    if (cuentaIndex < cuentas.length) {
        const cuenta = cuentas[cuentaIndex];
        const nombreCuenta = ordenParaFacturar.nombresCuentas[cuenta] || `Cuenta ${cuenta}`;
        const facturaInfo = `Facturar ${mesas.includes(ordenParaFacturar) ? 'Mesa' : 'Para Llevar'} ${ordenParaFacturar.numero} - Cuenta ${cuenta}: ${nombreCuenta}`;
        document.getElementById('factura-info').textContent = facturaInfo;
        const datos = ordenParaFacturar.factura?.[cuenta] || {};
        for (const [id, campo] of [['cedula', 'cedula'], ['nombre-completo', 'nombreCompleto'],
            ['direccion', 'direccion'], ['telefono', 'telefono'], ['correo', 'correo']]) {
            document.getElementById(id).value = datos[campo] || '';
        }
        document.getElementById('propina').value = datos.propina ?? '';
        const enviada = !!ordenParaFacturar.integracion?.[cuenta];
        for (const id of ['cedula', 'nombre-completo', 'direccion', 'telefono', 'correo', 'propina']) {
            document.getElementById(id).readOnly = enviada;
        }
        document.getElementById('enviar-precuenta').textContent = enviada ? 'Ver estado en LSoft · Caja' : 'Enviar cuenta a LSoft (simulado)';
        document.getElementById('precuenta-consumo').replaceChildren(tablaConsumo(ordenParaFacturar, cuenta));
        showScreen('facturacion-screen');
    } else {
        mostrarMesas();
        mostrarParaLlevar();
        mostrarCaja();
        showScreen('seleccion-mesas-screen');
        mostrarAviso(omitirEnviadas ? 'Las cuentas se enviaron a LSoft. Consulta el pago en LSoft · Caja. La mesa sigue abierta.' : 'Los datos se guardaron. La mesa sigue abierta.', omitirEnviadas ? 'Enviado a LSoft (simulación)' : 'Precuenta completada');
    }
}

// Función para confirmar la facturación de una cuenta
function accionPrecuenta() {
    const cuenta = cuentasParaFacturar(ordenParaFacturar)[cuentaIndex];
    if (ordenParaFacturar.integracion?.[cuenta]) seleccionarParaFacturacion(ordenParaFacturar);
    else confirmarFacturacion(true);
}

function confirmarFacturacion(enviarALSoft = false) {
    if (!exigirPermiso('operar', mesaSeleccionada)) return;
    const cuentaActual = cuentasParaFacturar(ordenParaFacturar || { ordenes: [] })[cuentaIndex];
    if (ordenParaFacturar?.integracion?.[cuentaActual]) {
        mostrarAviso('Los datos enviados a LSoft están bloqueados para mantener el pedido consistente.', 'Pedido enviado', 'aviso'); return;
    }
    const cedula = document.getElementById('cedula').value.trim();
    const nombreCompleto = document.getElementById('nombre-completo').value.trim();
    const direccion = document.getElementById('direccion').value.trim();
    const telefono = document.getElementById('telefono').value.trim();
    const correo = document.getElementById('correo').value.trim();

    // Validar que todos los campos están llenos
    if (!cedula || !nombreCompleto || !direccion || !telefono || !correo) {
        mostrarAviso('Por favor, completa todos los campos del cliente.', 'Faltan datos del cliente', 'aviso');
        return;
    }

    const entradaPropina = document.getElementById('propina');
    const propina = entradaPropina.value === '' ? 0 : Number(entradaPropina.value);
    if (entradaPropina.validity.badInput || !Number.isFinite(propina) || propina < 0
        || Math.abs(propina * 100 - Math.round(propina * 100)) > 0.000001) {
        mostrarAviso('La propina debe ser un importe positivo o cero, con hasta dos decimales.', 'Revisa la propina', 'aviso');
        return;
    }
    if (!document.getElementById('correo').checkValidity()) {
        mostrarAviso('Ingresa un correo electrónico válido.', 'Revisa el correo', 'aviso');
        return;
    }
    const cuentas = cuentasParaFacturar(ordenParaFacturar);
    if (cuentaIndex < cuentas.length) {
        const cuenta = cuentas[cuentaIndex];
        ordenParaFacturar.factura = ordenParaFacturar.factura || {};
        ordenParaFacturar.factura[cuenta] = {
            cedula,
            nombreCompleto,
            direccion,
            telefono,
            correo,
            propina
        };
        guardarEstado();
        if (enviarALSoft && !enviarCuentaLSoft(cuenta, false)) return;
        cuentaIndex++; // Incrementar el índice para la siguiente cuenta
        pedirDatosFacturaPorCuenta(enviarALSoft); // Pedir datos para la siguiente cuenta
    }
}

// Función para confirmar la facturación final de una orden en caja
function confirmarFacturacionFinal() {
    if (!exigirPermiso('administrar')) return;
    if (ordenParaFacturar) {
        const cuentas = cuentasParaFacturar(ordenParaFacturar);
        try {
            if (!cuentas.length || !cuentas.every(c => {
                const registro = ordenParaFacturar.integracion?.[c];
                return registro && adaptadorLSoft.consultar(registro.clave).estado === 'pagado';
            })) throw new Error('Todas las cuentas deben estar pagadas en LSoft antes de cerrar la mesa.');
            const cierres = JSON.parse(localStorage.getItem(CLAVE_CIERRES) || '[]');
            if (!cierres.some(c => c.id === ordenParaFacturar.operacionId)) {
                cierres.push({ id: ordenParaFacturar.operacionId, fecha: new Date().toISOString(),
                    tipo: mesas.includes(ordenParaFacturar) ? 'Mesa' : 'Para Llevar', numero: ordenParaFacturar.numero,
                    cuentas: cuentas.map(c => ({ pedido: contratoPedido(ordenParaFacturar, c), resultado: ordenParaFacturar.integracion[c] })) });
                localStorage.setItem(CLAVE_CIERRES, JSON.stringify(cierres));
            }
        } catch (error) { mostrarAviso(error.message, 'No se cerró la mesa', 'aviso'); return; }
        ordenParaFacturar.integracion = {};
        ordenParaFacturar.erroresLSoft = {};
        ordenParaFacturar.operacionId = null;
        document.getElementById('cerrar-mesa').disabled = true;
        console.log(`Confirmando facturación final para orden: ${ordenParaFacturar.numero}`); // Debug

        ordenParaFacturar.terminada = true; // Marcar la orden como terminada
        ordenParaFacturar.ocupada = false; // Liberar la mesa
        ordenParaFacturar.cuentaPedida = false; // Resetear el estado de cuentaPedida
        ordenParaFacturar.mesero = null;
        ordenParaFacturar.factura = {};
        ordenParaFacturar.nombresCuentas = {};
        ordenParaFacturar.ordenes = [{ estado: 'nueva', items: [] }]; // Resetear las órdenes

        mostrarMesas();
        mostrarParaLlevar();
        mostrarCaja();
        mostrarCocina();
        mostrarBar();

        console.log(`Orden facturada y completada para Mesa/Para Llevar ${ordenParaFacturar.numero}`); // Debug
        showScreen('caja-screen');
        mostrarCierres();
        mostrarAviso(`La orden ${ordenParaFacturar.numero} se cerró en esta demostración. No se emitió una factura fiscal.`, 'Orden completada');
    }
    guardarEstado();
}

// Función para actualizar el nombre de la cuenta
function actualizarNombreCuenta() {
    if (!exigirPermiso('operar', mesaSeleccionada)) return;
    if (mesaSeleccionada) {
        const cuentaActual = parseInt(document.getElementById('cuentas').value);
        const nombreCuenta = document.getElementById('nombre-cuenta').value.trim();
        mesaSeleccionada.nombresCuentas[cuentaActual] = nombreCuenta;
        console.log(`Nombre de la cuenta ${cuentaActual} actualizado a: ${nombreCuenta}`); // Debug
    }
    guardarEstado();
}

// Función para actualizar el número de cuentas
function actualizarCuentas() {
    if (!exigirPermiso('operar', mesaSeleccionada)) return;
    const cuentaActual = parseInt(document.getElementById('cuentas').value);
    const nombreInput = document.getElementById('nombre-cuenta');

    // Mostrar el nombre de la cuenta seleccionada
    nombreInput.value = mesaSeleccionada.nombresCuentas[cuentaActual] || '';

    actualizarCantidadesProductos();
    console.log(`Número de cuenta actualizado a: ${cuentaActual}`); // Debug
}

// Cada acción identifica tipo de pedido, grupo e ítem: mesa y para llevar pueden
// compartir número, y un mismo plato puede existir en varias cuentas o rondas.
function buscarPedido(tipo, numero) {
    return (tipo === 'mesa' ? mesas : paraLlevarOrdenes).find(p => p.numero === numero);
}

function refrescarPreparacion() {
    [...mesas, ...paraLlevarOrdenes].forEach(pedido => {
        const r = resumenPedido(pedido);
        pedido.terminada = itemsEnviados(pedido).length > 0 && r.preparar === 0;
    });
    mostrarMesas();
    mostrarParaLlevar();
    mostrarCocina();
    mostrarBar();
    mostrarCaja();
    guardarEstado();
}

function marcarPreparado(tipo, numero, grupoIndex, itemIndex, listo) {
    const pedido = buscarPedido(tipo, numero);
    const grupo = pedido?.ordenes[grupoIndex];
    if (!exigirPermiso('preparar', pedido, grupo?.estado === 'en cocina' ? 'cocina' : 'bar')) return;
    const item = grupo?.items[itemIndex];
    if (!item || (item.retirados || 0) > 0) return;
    item[grupo.estado === 'en cocina' ? 'enCocina' : 'enBar'] = listo ? 'terminado' : 'en preparación';
    refrescarPreparacion();
}

function retirarProducto(tipo, numero, grupoIndex, itemIndex, cantidad) {
    const pedido = buscarPedido(tipo, numero);
    if (!exigirPermiso('retirar', pedido)) return;
    const grupo = pedido?.ordenes[grupoIndex];
    const item = grupo?.items[itemIndex];
    const campo = grupo?.estado === 'en cocina' ? 'enCocina' : 'enBar';
    if (!item || item[campo] !== 'terminado' || !Number.isInteger(cantidad)
        || cantidad < 1 || cantidad > item.cantidad - (item.retirados || 0)) {
        mostrarAviso('Selecciona una cantidad válida de productos listos.', 'Revisa el retiro', 'aviso');
        return;
    }
    item.retirados = (item.retirados || 0) + cantidad;
    refrescarPreparacion();
}

function retirarTodoListo(tipo, numero, area = null) {
    const pedido = buscarPedido(tipo, numero);
    if (!exigirPermiso('retirar', pedido)) return;
    if (!pedido) return;
    itemsEnviados(pedido).forEach(({ item, area: destino }) => {
        if ((!area || area === destino) && item[destino === 'cocina' ? 'enCocina' : 'enBar'] === 'terminado') {
            item.retirados = item.cantidad;
        }
    });
    refrescarPreparacion();
}

function mostrarArea(area) {
    actualizarPendientes();
    const lista = document.getElementById(`${area}-list`);
    lista.replaceChildren();
    const historial = document.getElementById(`${area}-retirados`);
    historial.replaceChildren();
    let unidadesRetiradas = 0;
    [...mesas, ...paraLlevarOrdenes].forEach(pedido => {
        const enviados = itemsEnviados(pedido).filter(i => i.area === area);
        const nombrePedido = `${mesas.includes(pedido) ? 'Mesa' : 'Para Llevar'} ${pedido.numero}`;
        enviados.filter(({ item }) => (item.retirados || 0) > 0).forEach(({ item }) => {
            unidadesRetiradas += item.retirados;
            const fila = document.createElement('p');
            fila.className = 'withdrawn-row';
            fila.textContent = `${nombrePedido} · ${item.nombre} · ${item.retirados} retirados · Cuenta ${item.cuenta}${item.adicional ? ' · Adicional' : ''}${item.nota ? ` · Nota: ${item.nota}` : ''}`;
            historial.appendChild(fila);
        });
        const items = enviados.filter(({ item }) => (item.retirados || 0) < item.cantidad);
        if (!items.length) return;
        const tipo = mesas.includes(pedido) ? 'mesa' : 'llevar';
        const tarjeta = document.createElement('section');
        tarjeta.className = `${area}-item preparation-card`;
        const titulo = document.createElement('h4');
        titulo.textContent = `${tipo === 'mesa' ? 'Mesa' : 'Para Llevar'} ${pedido.numero}`;
        tarjeta.appendChild(titulo);
        const listos = items.reduce((total, { item }) => total +
            (item[area === 'cocina' ? 'enCocina' : 'enBar'] === 'terminado'
                ? item.cantidad - (item.retirados || 0) : 0), 0);
        const todo = document.createElement('button');
        todo.className = 'pickup-button';
        todo.textContent = `Retirar todo lo listo (${listos})`;
        todo.disabled = listos === 0;
        todo.onclick = () => retirarTodoListo(tipo, pedido.numero, area);
        todo.hidden = !permite('retirar', pedido);
        tarjeta.appendChild(todo);
        items.forEach(({ item, grupoIndex, itemIndex }) => {
            const fila = document.createElement('div');
            fila.className = 'preparation-row';
            const listo = item[area === 'cocina' ? 'enCocina' : 'enBar'] === 'terminado';
            const retirados = item.retirados || 0;
            const restantes = item.cantidad - retirados;
            const nombre = document.createElement('strong');
            nombre.textContent = `${item.nombre} × ${item.cantidad} · Cuenta ${item.cuenta}${item.adicional ? ' · Adicional' : ''}`;
            fila.appendChild(nombre);
            const estado = document.createElement('p');
            estado.textContent = `${restantes} ${listo ? 'listos para retirar' : 'en preparación'} · ${retirados} retirados`;
            fila.appendChild(estado);
            if (item.nota) {
                const nota = document.createElement('p');
                nota.textContent = `Nota: ${item.nota}`;
                fila.appendChild(nota);
            }
            const etiqueta = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = listo;
            checkbox.disabled = retirados > 0 || !permite('preparar', pedido, area);
            checkbox.onchange = () => marcarPreparado(tipo, pedido.numero, grupoIndex, itemIndex, checkbox.checked);
            etiqueta.append(checkbox, ' Preparado');
            fila.appendChild(etiqueta);
            if (listo && restantes > 0 && permite('retirar', pedido)) {
                const controles = document.createElement('div');
                controles.className = 'pickup-controls';
                const label = document.createElement('label');
                label.textContent = 'Cantidad a retirar ';
                const cantidad = document.createElement('input');
                cantidad.type = 'number';
                cantidad.min = '1';
                cantidad.max = String(restantes);
                cantidad.step = '1';
                cantidad.value = String(restantes);
                cantidad.setAttribute('aria-label', `Cantidad a retirar de ${item.nombre}, cuenta ${item.cuenta}`);
                label.appendChild(cantidad);
                const boton = document.createElement('button');
                boton.className = 'pickup-button';
                boton.textContent = 'Retirar';
                boton.onclick = () => retirarProducto(tipo, pedido.numero, grupoIndex, itemIndex, Number(cantidad.value));
                controles.append(label, boton);
                fila.appendChild(controles);
            }
            tarjeta.appendChild(fila);
        });
        lista.appendChild(tarjeta);
    });
    document.getElementById(`${area}-retirados-titulo`).textContent = `Ver retirados (${unidadesRetiradas})`;
    if (!lista.children.length) {
        const mensaje = document.createElement('p');
        mensaje.className = 'area-empty';
        mensaje.textContent = 'Todo al día. No hay productos pendientes de preparar o retirar.';
        lista.appendChild(mensaje);
    }
    if (!historial.children.length) {
        const mensaje = document.createElement('p');
        mensaje.textContent = 'No hay retiros en los pedidos actuales.';
        historial.appendChild(mensaje);
    }
}

function mostrarCocina() { mostrarArea('cocina'); }
function mostrarBar() { mostrarArea('bar'); }

// Función para calcular el tiempo de preparación
function calcularTiempoPreparacion(inicio) {
    const ahora = new Date();
    const diferencia = ahora - inicio;
    const minutos = Math.floor(diferencia / 60000);
    const segundos = ((diferencia % 60000) / 1000).toFixed(0);
    return `(${minutos}:${segundos < 10 ? '0' : ''}${segundos})`;
}

// Función para aumentar la cantidad de ítems en cocina
function aumentarCantidadCocina(ordenNumero, itemNombre, itemIndex) {
    if (!exigirPermiso('administrar')) return;
    const orden = mesas.find(m => m.numero === ordenNumero) || paraLlevarOrdenes.find(o => o.numero === ordenNumero);
    if (!orden) return;

    // Encontrar el ítem en la orden y aumentar la cantidad
    const item = orden.ordenes.flatMap(o => o.items).find((i, index) => i.nombre === itemNombre && index === itemIndex);
    if (item) {
        item.cantidad += 1;
        mostrarCocina();
        console.log(`Cantidad de ${itemNombre} aumentada a ${item.cantidad} en la cocina para orden ${ordenNumero}`); // Debug
    }
    guardarEstado();
}

// Función para disminuir la cantidad de ítems en cocina
function disminuirCantidadCocina(ordenNumero, itemNombre, itemIndex) {
    if (!exigirPermiso('administrar')) return;
    const orden = mesas.find(m => m.numero === ordenNumero) || paraLlevarOrdenes.find(o => o.numero === ordenNumero);
    if (!orden) return;

    // Encontrar el ítem en la orden y disminuir la cantidad
    const item = orden.ordenes.flatMap(o => o.items).find((i, index) => i.nombre === itemNombre && index === itemIndex);
    if (item) {
        item.cantidad -= 1;
        if (item.cantidad <= 0) {
            // Si la cantidad llega a 0, removemos el ítem
            const orderIndex = orden.ordenes.findIndex(o => o.items.includes(item));
            if (orderIndex > -1) orden.ordenes[orderIndex].items.splice(orden.ordenes[orderIndex].items.indexOf(item), 1);
        }
        mostrarCocina();
        console.log(`Cantidad de ${itemNombre} disminuida a ${item.cantidad} en la cocina para orden ${ordenNumero}`); // Debug
    }
    guardarEstado();
}

// Inicializar con la pantalla de inicio de sesión activa
document.addEventListener('DOMContentLoaded', () => {
    const menu = document.getElementById('app-menu');
    menu.addEventListener('click', evento => { if (evento.target === menu) cerrarMenu(); });
    menu.addEventListener('close', () => {
        document.getElementById('abrir-menu').setAttribute('aria-expanded', 'false');
        if (usuarioLogueado) document.getElementById('abrir-menu').focus();
    });
    document.addEventListener('click', evento => {
        const usuario = document.getElementById('user-menu');
        if (!usuario.contains(evento.target)) usuario.open = false;
    });
    document.addEventListener('keydown', evento => {
        if (evento.key === 'Escape') {
            if (menu.open) { evento.preventDefault(); cerrarMenu(); }
            const usuario = document.getElementById('user-menu');
            if (usuario.open) { usuario.open = false; usuario.querySelector('summary').focus(); }
        }
    });
    document.getElementById('detalle-dialogo').addEventListener('close', cerrarDetalleOrden);
    document.getElementById('detalle-dialogo').addEventListener('click', evento => {
        if (evento.target === evento.currentTarget) cerrarDetalleOrden();
    });
    window.addEventListener('resize', () => { if (window.innerWidth >= 900) cerrarDetalleOrden(); });
    document.getElementById('buscar-producto').addEventListener('input', renderizarMenu);
    document.getElementById('limpiar-busqueda').addEventListener('click', () => {
        document.getElementById('buscar-producto').value = '';
        renderizarMenu();
        document.getElementById('buscar-producto').focus();
    });
    document.getElementById('propina').addEventListener('input', actualizarTotalPrecuenta);
    recuperarAcceso();
    document.getElementById('contrasena').addEventListener('keydown', evento => {
        if (evento.key === 'Enter' && !evento.isComposing && !evento.repeat) {
            evento.preventDefault();
            iniciarSesion();
        }
    });
    document.getElementById('aviso-dialogo').addEventListener('close', () => {
        const pantalla = document.querySelector('.screen.active');
        const destino = pantalla && pantalla.contains(focoAntesDelAviso)
            ? focoAntesDelAviso : pantalla?.querySelector('input, button');
        destino?.focus();
        focoAntesDelAviso = null;
    });
    restaurarEstado();
    iniciarPrecios();
    iniciarMeseros();
    mostrarCierres();
    showScreen('login-screen');
    mostrarMesas();
    mostrarParaLlevar();
    mostrarCocina();
    mostrarBar();
    mostrarCaja();
    console.log("Aplicación inicializada"); // Debug
});
