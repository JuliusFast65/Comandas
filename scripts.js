const productos = {
    entradas: ['Bruschetta', 'Nachos', 'Quesadilla', 'Calamares', 'Alitas de Pollo', 'Tacos', 'Ceviche', 'Empanadas', 'Hummus', 'Mozzarella Sticks', 'Samosas', 'Spring Rolls', 'Dumplings', 'Guacamole', 'Carpaccio'],
    platos: ['Pizza', 'Pasta', 'Hamburguesa', 'Ensalada', 'Sushi', 'Burrito', 'Paella', 'Risotto', 'Pollo Asado', 'Steak', 'Lasaña', 'Fajitas', 'Costillas BBQ', 'Shawarma', 'Fish & Chips'],
    postres: ['Tarta de Queso', 'Brownie', 'Helado', 'Fruta', 'Tiramisú', 'Crème Brûlée', 'Panna Cotta', 'Pastel de Zanahoria', 'Mousse de Chocolate', 'Gelatina', 'Flan', 'Profiteroles', 'Trifle', 'Tarta de Manzana', 'Tarta de Limón'],
    bebidas: ['Coca-Cola', 'Jugo de Naranja', 'Agua', 'Té Helado', 'Limonada', 'Café', 'Chocolate Caliente', 'Batido de Fresa', 'Batido de Chocolate', 'Agua con Gas', 'Red Bull', 'Sprite', 'Fanta'],
    bebidasAlcoolicas: ['Vino Tinto', 'Vino Blanco', 'Cerveza', 'Whisky', 'Tequila', 'Vodka', 'Ginebra', 'Ron', 'Brandy', 'Licor', 'Champán', 'Sangría', 'Margarita', 'Martini', 'Bloody Mary'],
    adicionales: ['Papas Fritas', 'Arroz', 'Ensalada', 'Guacamole', 'Queso', 'Tortillas', 'Frijoles', 'Salsa', 'Pan', 'Aguacate', 'Tocino', 'Champiñones', 'Aros de Cebolla', 'Purée de Papas', 'Maíz']
};

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
    if (!almacenamientoDisponible) return;
    try {
        // Los datos personales de facturación no se guardan en este dispositivo.
        const sinFactura = ({ factura, ...pedido }) => pedido;
        localStorage.setItem(CLAVE_ESTADO, JSON.stringify({
            version: 1,
            mesas: mesas.map(sinFactura),
            paraLlevarOrdenes: paraLlevarOrdenes.map(sinFactura),
            paraLlevarCounter,
            tiemposDePreparacion
        }));
        mostrarEstadoGuardado('Pedidos guardados en este navegador');
    } catch (error) {
        mostrarEstadoGuardado('No se pudo guardar. Mantén esta página abierta.');
        console.warn('No se pudo guardar el estado de Comandas.', error.name);
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

function iniciarSesion() {
    const usuario = document.getElementById('usuario').value.trim();
    const contrasena = document.getElementById('contrasena').value.trim();

    if (usuario === '' || contrasena === '') {
        mostrarAviso('Por favor, ingresa el usuario y la contraseña.', 'Completa tus datos', 'aviso');
        return;
    }

    // Simulamos una verificación básica de usuario y contraseña
    if (usuario === 'admin' && contrasena === '1234') {
        recordarAcceso(usuario, contrasena);
        showScreen('seleccion-mesas-screen');
        console.log("Inicio de sesión exitoso"); // Debug
    } else {
        mostrarAviso('Usuario o contraseña incorrectos.', 'Revisa el acceso', 'aviso');
        console.log("Fallo en el inicio de sesión"); // Debug
    }
}

// Función para mostrar la pantalla deseada
function showScreen(screenId) {
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
    const cajaList = document.getElementById('caja-list');
    if (!cajaList) {
        console.error("El elemento con id 'caja-list' no existe.");
        return;
    }
    cajaList.innerHTML = ''; // Limpiar la lista de la caja

    console.log("Iniciando el proceso de mostrar las órdenes en caja."); // Debug

    // Iterar sobre cada mesa
    mesas.forEach(orden => {
        console.log(`Revisando mesa: ${orden.numero}, cuentaPedida: ${orden.cuentaPedida}, terminada: ${orden.terminada}`); // Debug
        if (orden.cuentaPedida && orden.terminada) {
            console.log(`Mesa ${orden.numero} cumple las condiciones para ser mostrada.`); // Debug
            const ordenDiv = document.createElement('div');
            const tipoOrden = 'Mesa';
            
            ordenDiv.className = 'caja-item';
            ordenDiv.innerHTML = `<h4>${tipoOrden} ${orden.numero}</h4>`;
            
            // Al hacer clic, seleccionar la orden para facturación
            ordenDiv.onclick = () => seleccionarParaFacturacion(orden);
            cajaList.appendChild(ordenDiv);

            console.log(`Mesa ${orden.numero} añadida a la lista de caja.`); // Debug
        } else {
            console.log(`Mesa ${orden.numero} no cumple las condiciones: cuentaPedida=${orden.cuentaPedida}, terminada=${orden.terminada}`); // Debug
        }
    });

    // Iterar sobre cada orden para llevar
    paraLlevarOrdenes.forEach(orden => {
        console.log(`Revisando orden para llevar: ${orden.numero}, cuentaPedida: ${orden.cuentaPedida}, terminada: ${orden.terminada}`); // Debug
        if (orden.cuentaPedida && !orden.terminada) {
            console.log(`Para Llevar ${orden.numero} cumple las condiciones para ser mostrado.`); // Debug
            const ordenDiv = document.createElement('div');
            const tipoOrden = 'Para Llevar';
            
            ordenDiv.className = 'caja-item';
            ordenDiv.innerHTML = `<h4>${tipoOrden} ${orden.numero}</h4>`;
            
            // Al hacer clic, seleccionar la orden para facturación
            ordenDiv.onclick = () => seleccionarParaFacturacion(orden);
            cajaList.appendChild(ordenDiv);

            console.log(`Para Llevar ${orden.numero} añadido a la lista de caja.`); // Debug
        } else {
            console.log(`Para Llevar ${orden.numero} no cumple las condiciones: cuentaPedida=${orden.cuentaPedida}, terminada=${orden.terminada}`); // Debug
        }
    });

    console.log("Órdenes en caja mostradas."); // Debug
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
    contenedor.replaceChildren(...mesas.map(mesa =>
        tarjetaPedido(mesa, `Mesa ${mesa.numero}`, () => seleccionarMesa(mesa.numero))));
    actualizarRetiroSeleccionado();
}

function mostrarParaLlevar() {
    const contenedor = document.getElementById('para-llevar');
    contenedor.replaceChildren(...paraLlevarOrdenes.map(pedido =>
        tarjetaPedido(pedido, `Para Llevar ${pedido.numero}`, () => seleccionarOrdenParaLlevar(pedido.numero))));
}

function actualizarRetiroSeleccionado() {
    const boton = document.getElementById('retirar-listos-mesa');
    if (!boton || !mesaSeleccionada) return;
    const r = resumenPedido(mesaSeleccionada);
    boton.disabled = r.retirar === 0;
    boton.textContent = r.retirar ? `Retirar todo lo listo (${r.retirar})` : 'No hay productos listos para retirar';
    boton.onclick = () => retirarTodoListo(mesas.includes(mesaSeleccionada) ? 'mesa' : 'llevar', mesaSeleccionada.numero);
}

// Función para seleccionar una mesa
function seleccionarMesa(numero) {
    console.log(`Seleccionando mesa: ${numero}`); // Debug
    mesaSeleccionada = mesas.find(m => m.numero === numero);
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
    mesaSeleccionada = paraLlevarOrdenes.find(o => o.numero === numero);
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
    const nuevaOrden = {
        numero: paraLlevarCounter,
        ocupada: false,
        terminada: false,
        cuentaPedida: false,
        nombresCuentas: {},
        ordenes: [{ estado: 'nueva', items: [] }]
    };
    paraLlevarCounter += 1;
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
    document.querySelectorAll('#categories .category').forEach(boton => {
        const seleccionada = boton.dataset.categoria === categoria;
        boton.classList.toggle('category-active', seleccionada);
        boton.setAttribute('aria-pressed', String(seleccionada));
    });
    document.getElementById('menu-titulo').textContent = nombresCategorias[categoria];
    const contenedor = document.getElementById('products');
    contenedor.replaceChildren(...productos[categoria].map(producto => {
        const tarjeta = document.createElement('button');
        tarjeta.type = 'button';
        tarjeta.className = `product ${categoria}`;
        tarjeta.dataset.producto = producto;
        const nombre = document.createElement('span');
        nombre.className = 'product-name';
        nombre.textContent = producto;
        const cantidad = document.createElement('span');
        cantidad.className = 'product-quantity';
        tarjeta.append(nombre, cantidad);
        tarjeta.onclick = () => agregarProducto(producto);
        return tarjeta;
    }));
    actualizarCantidadesProductos();
}

// Compatibilidad con llamadas anteriores: las categorías ya no se ocultan.
function showCategories() { showProducts(categoriaSeleccionada); }

// Función para agregar un producto a la orden
function agregarProducto(producto) {
    const cuenta = Number(document.getElementById('cuentas').value);
    if (!Number.isInteger(cuenta) || cuenta < 1) {
        mostrarAviso('Selecciona una cuenta válida antes de añadir productos.', 'Revisa la cuenta', 'aviso');
        return;
    }
    console.log(`Agregando producto: ${producto} a la cuenta: ${cuenta}`); // Debug

    // Buscar si el producto ya está en la orden para esta cuenta
    const index = orden.findIndex(item => item.nombre === producto && item.cuenta === cuenta && !item.enCocina && !item.enBar);

    if (index > -1) {
        // Si el producto ya está, aumentamos la cantidad
        orden[index].cantidad += 1;
    } else {
        // Si no está, lo añadimos a la orden
        orden.push({ nombre: producto, cantidad: 1, cuenta: cuenta, enCocina: false, enBar: false, nota: '' });
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
    notaIndex = index;
    console.log(`Abriendo modal para añadir nota al producto en el índice: ${index}`); // Debug
    document.getElementById('nota-texto').value = orden[index].nota || '';
    document.getElementById('nota-modal').style.display = 'block';
}

// Función para cerrar el modal de notas
function cerrarModal() {
    console.log("Cerrando modal de notas"); // Debug
    document.getElementById('nota-modal').style.display = 'none';
}

// Función para guardar la nota del modal
function guardarNota() {
    const nota = document.getElementById('nota-texto').value;
    if (notaIndex !== null) {
        orden[notaIndex].nota = nota;
        console.log(`Guardando nota para el producto en el índice: ${notaIndex}`); // Debug
        actualizarOrden();
    }
    cerrarModal();
    guardarEstado();
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
    console.log("Orden actualizada", orden); // Debug
}

// Función para confirmar la orden
function confirmarOrden() {
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
    console.log(`Intentando pedir cuenta para mesa: ${mesaSeleccionada.numero}, Estado actual: cuentaPedida=${mesaSeleccionada.cuentaPedida}`); // Debug

    if (!mesaSeleccionada.cuentaPedida) {
        mesaSeleccionada.cuentaPedida = true; // Cambiar el estado de cuentaPedida
        console.log(`Cuenta pedida para mesa: ${mesaSeleccionada.numero}, Estado nuevo: cuentaPedida=${mesaSeleccionada.cuentaPedida}`); // Debug

        ordenParaFacturar = mesaSeleccionada; // Guardar la mesa seleccionada para facturación
        cuentaIndex = 0; // Resetear el índice de la cuenta
        pedirDatosFacturaPorCuenta(); // Pedir datos para la primera cuenta
    } else {
        console.log(`La cuenta ya fue pedida para mesa: ${mesaSeleccionada.numero}`); // Debug
    }
    guardarEstado();
}

// Función para seleccionar una orden para facturación
function seleccionarParaFacturacion(orden) {
    ordenParaFacturar = orden;
    const tipoOrden = mesas.includes(orden) ? 'Mesa' : 'Para Llevar';
    const facturaInfo = `Facturar ${tipoOrden} ${orden.numero}`;
    document.getElementById('factura-info').textContent = facturaInfo;

    // Mostrar detalles de la orden
    const confirmacionList = document.getElementById('confirmacion-list');
    confirmacionList.innerHTML = ''; // Limpiar la lista de confirmación
    orden.ordenes.forEach(o => {
        o.items.forEach(item => {
            const listItem = document.createElement('li');
            listItem.style.marginBottom = '10px'; // Asegurar separación entre items
            listItem.innerHTML = `
                <div>${item.nombre} - ${item.cantidad}</div>
                ${item.nota ? `<div style="font-size: 12px; color: #666;">Nota: ${item.nota}</div>` : ''}
            `;
            confirmacionList.appendChild(listItem);
        });
    });

    showScreen('confirmacion-facturacion-screen'); // Mostrar pantalla de confirmación de facturación
    console.log(`Orden seleccionada para facturación: ${facturaInfo}`); // Debug
}

// Función para pedir datos de facturación por cuenta
function pedirDatosFacturaPorCuenta() {
    const cuentas = Object.keys(ordenParaFacturar.nombresCuentas);
    if (cuentaIndex < cuentas.length) {
        const cuenta = cuentas[cuentaIndex];
        const nombreCuenta = ordenParaFacturar.nombresCuentas[cuenta];
        const facturaInfo = `Facturar ${mesas.includes(ordenParaFacturar) ? 'Mesa' : 'Para Llevar'} ${ordenParaFacturar.numero} - Cuenta ${cuenta}: ${nombreCuenta}`;
        document.getElementById('factura-info').textContent = facturaInfo;
        showScreen('facturacion-screen');
    } else {
        // Si ya se pidieron los datos para todas las cuentas, regresar a selección de mesas
        showScreen('seleccion-mesas-screen');
    }
}

// Función para confirmar la facturación de una cuenta
function confirmarFacturacion() {
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

    const cuentas = Object.keys(ordenParaFacturar.nombresCuentas);
    if (cuentaIndex < cuentas.length) {
        const cuenta = cuentas[cuentaIndex];
        ordenParaFacturar.factura = ordenParaFacturar.factura || {};
        ordenParaFacturar.factura[cuenta] = {
            cedula,
            nombreCompleto,
            direccion,
            telefono,
            correo
        };
        cuentaIndex++; // Incrementar el índice para la siguiente cuenta
        pedirDatosFacturaPorCuenta(); // Pedir datos para la siguiente cuenta
    }
}

// Función para confirmar la facturación final de una orden en caja
function confirmarFacturacionFinal() {
    if (ordenParaFacturar) {
        console.log(`Confirmando facturación final para orden: ${ordenParaFacturar.numero}`); // Debug

        ordenParaFacturar.terminada = true; // Marcar la orden como terminada
        ordenParaFacturar.ocupada = false; // Liberar la mesa
        ordenParaFacturar.cuentaPedida = false; // Resetear el estado de cuentaPedida
        ordenParaFacturar.ordenes = [{ estado: 'nueva', items: [] }]; // Resetear las órdenes

        mostrarMesas();
        mostrarParaLlevar();
        mostrarCaja();

        console.log(`Orden facturada y completada para Mesa/Para Llevar ${ordenParaFacturar.numero}`); // Debug
        showScreen('caja-screen');
        mostrarAviso(`La orden ${ordenParaFacturar.numero} se cerró en esta demostración. No se emitió una factura fiscal.`, 'Orden completada');
    }
    guardarEstado();
}

// Función para actualizar el nombre de la cuenta
function actualizarNombreCuenta() {
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
    const item = grupo?.items[itemIndex];
    if (!item || (item.retirados || 0) > 0) return;
    item[grupo.estado === 'en cocina' ? 'enCocina' : 'enBar'] = listo ? 'terminado' : 'en preparación';
    refrescarPreparacion();
}

function retirarProducto(tipo, numero, grupoIndex, itemIndex, cantidad) {
    const pedido = buscarPedido(tipo, numero);
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
    [...mesas, ...paraLlevarOrdenes].forEach(pedido => {
        const items = itemsEnviados(pedido).filter(i => i.area === area);
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
            checkbox.disabled = retirados > 0;
            checkbox.onchange = () => marcarPreparado(tipo, pedido.numero, grupoIndex, itemIndex, checkbox.checked);
            etiqueta.append(checkbox, ' Preparado');
            fila.appendChild(etiqueta);
            if (listo && restantes > 0) {
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
    showScreen('login-screen');
    mostrarMesas();
    mostrarParaLlevar();
    mostrarCocina();
    mostrarBar();
    mostrarCaja();
    console.log("Aplicación inicializada"); // Debug
});
