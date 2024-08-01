const productos = {
    entradas: ['Bruschetta', 'Nachos', 'Quesadilla', 'Calamares', 'Alitas de Pollo', 'Tacos', 'Ceviche', 'Empanadas', 'Hummus', 'Mozzarella Sticks', 'Samosas', 'Spring Rolls', 'Dumplings', 'Guacamole', 'Carpaccio'],
    platos: ['Pizza', 'Pasta', 'Hamburguesa', 'Ensalada', 'Sushi', 'Burrito', 'Paella', 'Risotto', 'Pollo Asado', 'Steak', 'Lasaña', 'Fajitas', 'Costillas BBQ', 'Shawarma', 'Fish & Chips'],
    postres: ['Tarta de Queso', 'Brownie', 'Helado', 'Fruta', 'Tiramisú', 'Crème Brûlée', 'Panna Cotta', 'Pastel de Zanahoria', 'Mousse de Chocolate', 'Gelatina', 'Flan', 'Profiteroles', 'Trifle', 'Tarta de Manzana', 'Tarta de Limón'],
    bebidas: ['Coca-Cola', 'Jugo de Naranja', 'Agua', 'Cerveza', 'Té Helado', 'Limonada', 'Café', 'Chocolate Caliente', 'Batido de Fresa', 'Batido de Chocolate', 'Agua con Gas', 'Red Bull', 'Sprite', 'Fanta', 'Vino'],
    bebidasAlcoolicas: ['Vino Tinto', 'Vino Blanco', 'Cerveza', 'Whisky', 'Tequila', 'Vodka', 'Ginebra', 'Ron', 'Brandy', 'Licor', 'Champán', 'Sangría', 'Margarita', 'Martini', 'Bloody Mary'],
    adicionales: ['Papas Fritas', 'Arroz', 'Ensalada', 'Guacamole', 'Queso', 'Tortillas', 'Frijoles', 'Salsa', 'Pan', 'Aguacate', 'Tocino', 'Champiñones', 'Aros de Cebolla', 'Purée de Papas', 'Maíz']
};

const mesas = [
    { numero: 1, ocupada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 2, ocupada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 3, ocupada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 4, ocupada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 5, ocupada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 6, ocupada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 7, ocupada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 8, ocupada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 9, ocupada: false, ordenes: [{ estado: 'nueva', items: [] }] },
    { numero: 10, ocupada: false, ordenes: [{ estado: 'nueva', items: [] }] }
];

let orden = [];
let ordenEnCocina = [];
let mesaSeleccionada = null;
let cuentas = 1;
let notaIndex = null;
let paraLlevarCounter = 1;
let paraLlevarOrdenes = [];

// Función para mostrar la pantalla deseada
function showScreen(screenId) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
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
        mesaDiv.className = `mesa ${mesa.ocupada ? 'ocupada' : 'libre'}`;
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
        ordenDiv.className = `mesa ${orden.ocupada ? 'ocupada' : 'libre'}`; // Cambiar el color según el estado
        ordenDiv.textContent = `Para Llevar ${orden.numero}`;
        ordenDiv.onclick = () => seleccionarOrdenParaLlevar(orden.numero);
        paraLlevarDiv.appendChild(ordenDiv);
    });
}

// Función para seleccionar una mesa
function seleccionarMesa(numero) {
    mesaSeleccionada = mesas.find(m => m.numero === numero);
    document.getElementById('orden-tipo').textContent = "Mesa";
    document.getElementById('orden-numero').textContent = mesaSeleccionada.numero;
    document.getElementById('mesa-label').style.display = 'block'; // Mostrar el label de mesa
    document.getElementById('para-llevar-checkbox').checked = false;
    ordenEnCocina = mesaSeleccionada.ordenes.filter(o => o.estado === 'en cocina').flatMap(o => o.items);
    orden = mesaSeleccionada.ordenes.find(o => o.estado === 'nueva')?.items || [];
    actualizarOrden();
    showScreen('toma-ordenes-screen');
}

// Función para seleccionar una orden para llevar
function seleccionarOrdenParaLlevar(numero) {
    mesaSeleccionada = paraLlevarOrdenes.find(o => o.numero === numero);
    document.getElementById('orden-tipo').textContent = "Para Llevar";
    document.getElementById('orden-numero').textContent = mesaSeleccionada.numero;
    document.getElementById('mesa-label').style.display = 'none'; // Ocultar el label de mesa
    document.getElementById('para-llevar-checkbox').checked = true;
    ordenEnCocina = mesaSeleccionada.ordenes.filter(o => o.estado === 'en cocina').flatMap(o => o.items);
    orden = mesaSeleccionada.ordenes.find(o => o.estado === 'nueva')?.items || [];
    actualizarOrden();
    showScreen('toma-ordenes-screen');
}

// Función para crear una nueva orden para llevar
function crearParaLlevar() {
    const nuevaOrden = {
        numero: paraLlevarCounter,
        ocupada: false,
        ordenes: [{ estado: 'nueva', items: [] }]
    };
    paraLlevarCounter += 1;
    paraLlevarOrdenes.push(nuevaOrden);
    mostrarParaLlevar();
}

// Función para mostrar productos según la categoría seleccionada
function showProducts(categoria) {
    document.getElementById('categories').style.display = 'none';
    document.getElementById('back-to-categories').style.display = 'block';
    const productsDiv = document.getElementById('products');
    productsDiv.style.display = 'flex';
    productsDiv.innerHTML = ''; // Limpiar el contenedor de productos
    productos[categoria].forEach(producto => {
        const productDiv = document.createElement('div');
        productDiv.className = 'product';
        productDiv.textContent = producto;
        productDiv.onclick = () => agregarProducto(producto);
        productsDiv.appendChild(productDiv);
    });
}

// Función para volver a mostrar las categorías
function showCategories() {
    document.getElementById('categories').style.display = 'flex';
    document.getElementById('back-to-categories').style.display = 'none';
    document.getElementById('products').style.display = 'none';
}

// Función para agregar un producto a la orden
function agregarProducto(producto) {
    const cuenta = parseInt(document.getElementById('cuentas').value);
    const index = orden.findIndex(item => item.nombre === producto && item.cuenta === cuenta && !item.enCocina);
    if (index > -1) {
        orden[index].cantidad += 1;
    } else {
        orden.push({ nombre: producto, cantidad: 1, cuenta: cuenta, enCocina: false, nota: '' });
    }
    actualizarOrden();
}

// Función para disminuir la cantidad de un producto en la orden
function disminuirCantidad(producto, cuenta) {
    const index = orden.findIndex(item => item.nombre === producto && item.cuenta === cuenta && !item.enCocina);
    if (index > -1) {
        orden[index].cantidad -= 1;
        if (orden[index].cantidad === 0) {
            orden.splice(index, 1);
        }
    }
    actualizarOrden();
}

// Función para abrir el modal para añadir notas a un producto
function abrirModalNota(index) {
    notaIndex = index;
    document.getElementById('nota-texto').value = orden[index].nota || '';
    document.getElementById('nota-modal').style.display = 'block';
}

// Función para cerrar el modal de notas
function cerrarModal() {
    document.getElementById('nota-modal').style.display = 'none';
}

// Función para guardar la nota del modal
function guardarNota() {
    const nota = document.getElementById('nota-texto').value;
    if (notaIndex !== null) {
        orden[notaIndex].nota = nota;
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
    
    // Mostrar los items que aún no están en cocina
    orden.filter(item => !item.enCocina).forEach((item, index) => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            ${item.nombre} - ${item.cantidad}${item.cuenta !== 1 ? ` (Cuenta ${item.cuenta})` : ''}
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
}

// Función para confirmar la orden
function confirmarOrden() {
    const confirmacionList = document.getElementById('confirmacion-list');
    confirmacionList.innerHTML = ''; // Limpiar la lista de confirmación
    
    // Mostrar los items en cocina
    ordenEnCocina.forEach(item => {
        const listItem = document.createElement('li');
        listItem.textContent = `${item.nombre} - ${item.cantidad} (En cocina)`;
        confirmacionList.appendChild(listItem);
    });
    
    // Mostrar los items que aún no están en cocina
    orden.filter(item => !item.enCocina).forEach(item => {
        const listItem = document.createElement('li');
        listItem.textContent = `${item.nombre} - ${item.cantidad}${item.cuenta !== 1 ? ` (Cuenta ${item.cuenta})` : ''}`;
        confirmacionList.appendChild(listItem);
    });
    
    showScreen('confirmacion-screen');
}

// Función para enviar la orden a la cocina
function enviarCocina() {
    let ordenNueva = mesaSeleccionada.ordenes.find(o => o.estado === 'nueva');
    if (!ordenNueva) {
        ordenNueva = { estado: 'nueva', items: [] };
        mesaSeleccionada.ordenes.push(ordenNueva);
    }
    // Marcar los items como en cocina
    ordenNueva.items = orden.filter(item => !item.enCocina).map(item => ({ ...item, enCocina: true }));
    mesaSeleccionada.ordenes.push({ estado: 'en cocina', items: ordenNueva.items });
    mesaSeleccionada.ocupada = true; // Marcar la mesa como ocupada
    mostrarMesas();
    mostrarParaLlevar();
    mostrarCocina();
    alert('Orden enviada a la cocina');
    showScreen('seleccion-mesas-screen');
}

// Función para cancelar la orden y volver a la pantalla de selección de mesas
function cancelarOrden() {
    showScreen('seleccion-mesas-screen');
}

// Función para autorizar cambios con un código
function autorizar() {
    const authCode = document.getElementById('auth-code').value;
    if (authCode === '1234') { // Simulación de código de autorización
        alert('Autorización exitosa');
        showScreen('toma-ordenes-screen');
    } else {
        alert('Código incorrecto');
    }
}

// Función para actualizar el número de cuentas
function actualizarCuentas() {
    cuentas = parseInt(document.getElementById('cuentas').value);
    actualizarOrden();
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
            ordenDiv.className = 'cocina-item';
            ordenDiv.innerHTML = `<h4>${orden.ordenes.some(o => o.estado === 'nueva') ? 'Mesa' : 'Para Llevar'} ${orden.numero}</h4>`;
            
            ordenesCocina.forEach(orden => {
                orden.items.forEach(item => {
                    const itemDiv = document.createElement('div');
                    itemDiv.innerHTML = `
                        <p>${item.nombre} - ${item.cantidad} ${item.nota ? `<br><small>Nota: ${item.nota}</small>` : ''}</p>
                        <label class="checkbox-label">
                            <input type="checkbox" onchange="actualizarEstadoOrden(${orden.numero}, '${item.nombre}', this.checked ? 'terminado' : 'en preparación')"> Terminado
                        </label>
                    `;
                    itemDiv.style.textAlign = "left"; // Alinear el texto a la izquierda para mejor estética
                    ordenDiv.appendChild(itemDiv);
                });
            });

            cocinaList.appendChild(ordenDiv);
        }
    });
}

// Función para actualizar el estado de un ítem en la orden
function actualizarEstadoOrden(ordenNumero, itemNombre, estado) {
    const orden = [...mesas, ...paraLlevarOrdenes].find(o => o.numero === ordenNumero);
    orden.ordenes.forEach(orden => {
        orden.items.forEach(item => {
            if (item.nombre === itemNombre) {
                item.estado = estado;
            }
        });
    });
}

// Inicializar con la pantalla de inicio de sesión activa
document.addEventListener('DOMContentLoaded', () => {
    showScreen('login-screen');
    mostrarMesas();
    mostrarParaLlevar();
    mostrarCocina();
});
