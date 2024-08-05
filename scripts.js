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
    { numero: 1, ocupada: false, terminada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 2, ocupada: false, terminada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 3, ocupada: false, terminada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 4, ocupada: false, terminada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 5, ocupada: false, terminada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 6, ocupada: false, terminada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 7, ocupada: false, terminada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 8, ocupada: false, terminada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 9, ocupada: false, terminada: false, ordenes: [{ estado: 'nueva', items: [] }] }
];

let orden = [];
let ordenEnCocina = [];
let ordenEnBar = [];
let mesaSeleccionada = null;
let cuentas = 1;
let notaIndex = null;
let paraLlevarCounter = 1;
let paraLlevarOrdenes = [];

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
        mesaDiv.className = `mesa ${mesa.ocupada ? (mesa.terminada ? 'terminada' : 'ocupada') : 'libre'}`;
        mesaDiv.textContent = `Mesa ${mesa.numero}`;
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
        ordenDiv.className = `mesa ${orden.ocupada ? (orden.terminada ? 'terminada' : 'ocupada') : 'libre'}`; // Cambiar el color según el estado
        ordenDiv.textContent = `Para Llevar ${orden.numero}`;
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

// Función para actualizar el número de cuentas
function actualizarCuentas() {
    cuentas = parseInt(document.getElementById('cuentas').value);
    actualizarOrden();
    console.log(`Número de cuentas actualizado a: ${cuentas}`); // Debug
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
            // Usar el tipo correcto (Mesa o Para Llevar) para el encabezado
            const tipoOrden = mesas.includes(orden) ? 'Mesa' : 'Para Llevar';
            ordenDiv.className = 'cocina-item';
            ordenDiv.innerHTML = `<h4>${tipoOrden} ${orden.numero}</h4>`;
            
            // Iterar sobre cada ítem de la orden
            ordenesCocina.forEach(o => {
                o.items.forEach(item => {
                    const itemDiv = document.createElement('div');
                    itemDiv.style.display = "flex";
                    itemDiv.style.flexDirection = "column"; // Cambiar para dos líneas por ítem
                    itemDiv.style.alignItems = "flex-start"; // Alinear los elementos a la izquierda
                    itemDiv.innerHTML = `
                        <div style="display: flex; justify-content: space-between; width: 100%;">
                            <span>${item.nombre} - ${item.cantidad}</span>
                            <input type="checkbox" onchange="actualizarEstadoOrden(${orden.numero}, '${item.nombre}', this.checked ? 'terminado' : 'en preparación', 'cocina')" ${item.enCocina === 'terminado' ? 'checked' : ''}>
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
            // Usar el tipo correcto (Mesa o Para Llevar) para el encabezado
            const tipoOrden = mesas.includes(orden) ? 'Mesa' : 'Para Llevar';
            ordenDiv.className = 'bar-item';
            ordenDiv.innerHTML = `<h4>${tipoOrden} ${orden.numero}</h4>`;
            
            // Iterar sobre cada ítem de la orden
            ordenesBar.forEach(o => {
                o.items.forEach(item => {
                    const itemDiv = document.createElement('div');
                    itemDiv.style.display = "flex";
                    itemDiv.style.flexDirection = "column"; // Cambiar para dos líneas por ítem
                    itemDiv.style.alignItems = "flex-start"; // Alinear los elementos a la izquierda
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

// Inicializar con la pantalla de inicio de sesión activa
document.addEventListener('DOMContentLoaded', () => {
    showScreen('login-screen');
    mostrarMesas();
    mostrarParaLlevar();
    mostrarCocina();
    mostrarBar();
    console.log("Aplicación inicializada"); // Debug
});
