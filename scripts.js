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

// Función para manejar el inicio de sesión
function iniciarSesion() {
    const usuario = document.getElementById('usuario').value.trim();
    const contrasena = document.getElementById('contrasena').value.trim();

    if (usuario === '' || contrasena === '') {
        alert('Por favor, ingresa el usuario y la contraseña.');
        return;
    }

    // Simulamos una verificación básica de usuario y contraseña
    if (usuario === 'admin' && contrasena === '1234') {
        showScreen('seleccion-mesas-screen');
        console.log("Inicio de sesión exitoso"); // Debug
    } else {
        alert('Usuario o contraseña incorrectos.');
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
function mostrarMesas() {
    const mesasDiv = document.getElementById('mesas');
    if (!mesasDiv) {
        console.error("El elemento con id 'mesas' no existe.");
        return;
    }
    mesasDiv.innerHTML = ''; // Limpiar el contenedor de mesas
    mesas.forEach(mesa => {
        const mesaDiv = document.createElement('div');
        if (mesa.cuentaPedida) {
            mesaDiv.className = `mesa cuenta-pedida`;
        } else {
            mesaDiv.className = `mesa ${mesa.ocupada ? (mesa.terminada ? 'terminada' : 'ocupada') : 'libre'}`;
        }
        mesaDiv.textContent = `Mesa ${mesa.numero}`; // Solo mostrar el número de la mesa
        mesaDiv.onclick = () => seleccionarMesa(mesa.numero);
        mesasDiv.appendChild(mesaDiv);
    });
}

// Función para mostrar las órdenes para llevar
function mostrarParaLlevar() {
    const paraLlevarDiv = document.getElementById('para-llevar');
    if (!paraLlevarDiv) {
        console.error("El elemento con id 'para-llevar' no existe.");
        return;
    }
    paraLlevarDiv.innerHTML = ''; // Limpiar el contenedor de órdenes para llevar
    paraLlevarOrdenes.forEach(orden => {
        const ordenDiv = document.createElement('div');
        if (orden.cuentaPedida) {
            ordenDiv.className = `mesa cuenta-pedida`;
        } else {
            ordenDiv.className = `mesa ${orden.ocupada ? (orden.terminada ? 'terminada' : 'ocupada') : 'libre'}`;
        }
        ordenDiv.textContent = `Para Llevar ${orden.numero}`; // Solo mostrar el número de la orden para llevar
        ordenDiv.onclick = () => seleccionarOrdenParaLlevar(orden.numero);
        paraLlevarDiv.appendChild(ordenDiv);
    });
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
}

// Función para mostrar productos según la categoría seleccionada
function showProducts(categoria) {
    console.log(`Mostrando productos de la categoría: ${categoria}`); // Debug
    document.getElementById('categories').style.display = 'none'; // Ocultar categorías
    document.getElementById('back-to-categories').style.display = 'block';
    const productsDiv = document.getElementById('products');
    productsDiv.style.display = 'flex'; // Asegurarse de que el contenedor de productos esté visible
    productsDiv.innerHTML = ''; // Limpiar el contenedor de productos
    productos[categoria].forEach(producto => {
        const productDiv = document.createElement('div');
        productDiv.className = `product ${categoria}`;
        productDiv.textContent = producto;
        productDiv.onclick = () => agregarProducto(producto);
        productsDiv.appendChild(productDiv);
    });
}

// Función para volver a mostrar las categorías
function showCategories() {
    console.log("Volviendo a mostrar categorías"); // Debug
    document.getElementById('categories').style.display = 'flex';
    document.getElementById('back-to-categories').style.display = 'none';
    document.getElementById('products').style.display = 'none';
}

// Función para agregar un producto a la orden
function agregarProducto(producto) {
    const cuenta = parseInt(document.getElementById('cuentas').value);
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

    itemsParaEnviar.forEach(item => {
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

    mesaSeleccionada.ocupada = true; // Marcar la mesa como ocupada
    mostrarMesas();
    mostrarParaLlevar();
    mostrarCocina();
    mostrarBar();
    alert('Orden enviada a preparación');
    showScreen('seleccion-mesas-screen');
    console.log(`Orden enviada a cocina/bar para Mesa/Para Llevar ${mesaSeleccionada.numero}`); // Debug
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
        alert('Por favor, complete todos los campos del cliente.');
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

        alert(`Orden facturada y completada para ${ordenParaFacturar.numero}.`);
        console.log(`Orden facturada y completada para Mesa/Para Llevar ${ordenParaFacturar.numero}`); // Debug
        showScreen('caja-screen');
    }
}

// Función para actualizar el nombre de la cuenta
function actualizarNombreCuenta() {
    if (mesaSeleccionada) {
        const cuentaActual = parseInt(document.getElementById('cuentas').value);
        const nombreCuenta = document.getElementById('nombre-cuenta').value.trim();
        mesaSeleccionada.nombresCuentas[cuentaActual] = nombreCuenta;
        console.log(`Nombre de la cuenta ${cuentaActual} actualizado a: ${nombreCuenta}`); // Debug
    }
}

// Función para actualizar el número de cuentas
function actualizarCuentas() {
    const cuentaActual = parseInt(document.getElementById('cuentas').value);
    const nombreInput = document.getElementById('nombre-cuenta');

    // Mostrar el nombre de la cuenta seleccionada
    nombreInput.value = mesaSeleccionada.nombresCuentas[cuentaActual] || '';

    console.log(`Número de cuenta actualizado a: ${cuentaActual}`); // Debug
}

// Función para mostrar las órdenes en la pantalla de cocina
function mostrarCocina() {
    const cocinaList = document.getElementById('cocina-list');
    if (!cocinaList) {
        console.error("El elemento con id 'cocina-list' no existe.");
        return;
    }
    cocinaList.innerHTML = ''; // Limpiar la lista de cocina

    [...mesas, ...paraLlevarOrdenes].forEach(orden => {
        const ordenesCocina = orden.ordenes.filter(o => o.estado === 'en cocina');
        if (ordenesCocina.length > 0) {
            const ordenDiv = document.createElement('div');
            const tipoOrden = mesas.includes(orden) ? 'Mesa' : 'Para Llevar';
            ordenDiv.className = 'cocina-item';
            ordenDiv.innerHTML = `<h4>${tipoOrden} ${orden.numero}</h4>`; // Solo mostrar el número de la mesa o la orden para llevar

            // Iterar sobre cada ítem de la orden
            ordenesCocina.forEach(o => {
                o.items.forEach((item, index) => {
                    const itemDiv = document.createElement('div');
                    itemDiv.style.display = "flex";
                    itemDiv.style.flexDirection = "column";
                    itemDiv.style.alignItems = "flex-start";
                    const tiempoInicio = tiemposDePreparacion.find(t => t.nombre === item.nombre && t.cuenta === index);
                    const tiempo = tiempoInicio ? calcularTiempoPreparacion(tiempoInicio.inicio) : '';
                    itemDiv.innerHTML = `
                        <div style="display: flex; justify-content: space-between; width: 100%;">
                            <span>${item.nombre} - ${item.cantidad} ${tiempo}</span>
                            <div class="quantity-controls">
                                <button onclick="disminuirCantidadCocina(${orden.numero}, '${item.nombre}', ${o.items.indexOf(item)})">-</button>
                                <button onclick="aumentarCantidadCocina(${orden.numero}, '${item.nombre}', ${o.items.indexOf(item)})">+</button>
                                <button onclick="abrirModalNota(${o.items.indexOf(item)})">📝</button>
                                <input type="checkbox" onchange="actualizarEstadoOrden(${orden.numero}, '${item.nombre}', this.checked ? 'terminado' : 'en preparación', 'cocina')" ${item.enCocina === 'terminado' ? 'checked' : ''}>
                            </div>
                        </div>
                        ${item.nota ? `<div style="font-size: 12px; color: #666;">Nota: ${item.nota}</div>` : ''}
                    `;
                    ordenDiv.appendChild(itemDiv);
                });
            });

            cocinaList.appendChild(ordenDiv);
        }
    });
    console.log("Órdenes en cocina mostradas"); // Debug
}

// Función para mostrar las órdenes en la pantalla del bar
function mostrarBar() {
    const barList = document.getElementById('bar-list');
    if (!barList) {
        console.error("El elemento con id 'bar-list' no existe.");
        return;
    }
    barList.innerHTML = ''; // Limpiar la lista del bar

    [...mesas, ...paraLlevarOrdenes].forEach(orden => {
        const ordenesBar = orden.ordenes.filter(o => o.estado === 'en bar');
        if (ordenesBar.length > 0) {
            const ordenDiv = document.createElement('div');
            const tipoOrden = mesas.includes(orden) ? 'Mesa' : 'Para Llevar';
            ordenDiv.className = 'bar-item';
            ordenDiv.innerHTML = `<h4>${tipoOrden} ${orden.numero}</h4>`; // Solo mostrar el número de la mesa o la orden para llevar

            // Iterar sobre cada ítem de la orden
            ordenesBar.forEach(o => {
                o.items.forEach(item => {
                    const itemDiv = document.createElement('div');
                    itemDiv.style.display = "flex";
                    itemDiv.style.flexDirection = "column";
                    itemDiv.style.alignItems = "flex-start";
                    itemDiv.innerHTML = `
                        <div style="display: flex; justify-content: space-between; width: 100%;">
                            <span>${item.nombre} - ${item.cantidad}</span>
                            <input type="checkbox" onchange="actualizarEstadoOrden(${orden.numero}, '${item.nombre}', this.checked ? 'terminado' : 'en preparación', 'bar')" ${item.enBar === 'terminado' ? 'checked' : ''}>
                        </div>
                        ${item.nota ? `<div style="font-size: 12px; color: #666;">Nota: ${item.nota}</div>` : ''}
                    `;
                    ordenDiv.appendChild(itemDiv);
                });
            });

            barList.appendChild(ordenDiv);
        }
    });
    console.log("Órdenes en bar mostradas"); // Debug
}

// Función para actualizar el estado de un ítem en la orden
function actualizarEstadoOrden(ordenNumero, itemNombre, estado, area) {
    console.log(`Actualizando estado de ítem: ${itemNombre} a ${estado} en ${area} para orden ${ordenNumero}`); // Debug
    const orden = mesas.find(m => m.numero === ordenNumero) || paraLlevarOrdenes.find(o => o.numero === ordenNumero);

    if (!orden) {
        console.error("Orden no encontrada.");
        return;
    }

    let ordenTerminada = true; // Inicializamos la bandera de orden terminada

    // Iterar sobre cada orden y sus ítems
    orden.ordenes.forEach(o => {
        o.items.forEach(item => {
            if (item.nombre === itemNombre) {
                if (area === 'cocina') {
                    item.enCocina = estado;
                }
                if (area === 'bar') {
                    item.enBar = estado;
                }
                console.log(`Estado actualizado: ${item.nombre} en ${area} es ${item.enCocina || item.enBar}`); // Debug
            }
            // Si hay algún ítem que no esté terminado, la orden no está completa
            if ((item.enCocina !== 'terminado' && area === 'cocina') || (item.enBar !== 'terminado' && area === 'bar')) {
                ordenTerminada = false;
            }
        });
    });

    // Si todos los ítems de la orden están terminados, marcamos la mesa o el pedido como terminado
    if (ordenTerminada) {
        orden.terminada = true;
        console.log(`Orden ${ordenNumero} terminada en ${area}`); // Debug
    } else {
        orden.terminada = false;
    }

    mostrarMesas();
    mostrarParaLlevar();
    mostrarCocina();
    mostrarBar();
}

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
}

// Inicializar con la pantalla de inicio de sesión activa
document.addEventListener('DOMContentLoaded', () => {
    showScreen('login-screen');
    mostrarMesas();
    mostrarParaLlevar();
    mostrarCocina();
    mostrarBar();
    mostrarCaja();
    console.log("Aplicación inicializada"); // Debug
});
