const productos = {
    entradas: ['Bruschetta', 'Nachos', 'Quesadilla', 'Calamares'],
    platos: ['Pizza', 'Pasta', 'Hamburguesa', 'Ensalada'],
    postres: ['Tarta de Queso', 'Brownie', 'Helado', 'Fruta'],
    bebidas: ['Coca-Cola', 'Jugo de Naranja', 'Agua', 'Cerveza']
};

const mesas = [
    { numero: 1, ocupada: false, orden: [] },
    { numero: 2, ocupada: true, orden: [{ nombre: 'Pizza', cantidad: 2 }, { nombre: 'Coca-Cola', cantidad: 1 }] },
    { numero: 3, ocupada: false, orden: [] },
    { numero: 4, ocupada: true, orden: [{ nombre: 'Bruschetta', cantidad: 1 }, { nombre: 'Jugo de Naranja', cantidad: 2 }] }
];

let orden = [];
let mesaSeleccionada = null;

function showScreen(screenId) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function mostrarMesas() {
    const mesasDiv = document.getElementById('mesas');
    mesasDiv.innerHTML = '';
    mesas.forEach(mesa => {
        const mesaDiv = document.createElement('div');
        mesaDiv.className = `mesa ${mesa.ocupada ? 'ocupada' : 'libre'}`;
        mesaDiv.textContent = `Mesa ${mesa.numero}`;
        mesaDiv.onclick = () => seleccionarMesa(mesa.numero);
        mesasDiv.appendChild(mesaDiv);
    });
}

function seleccionarMesa(numero) {
    const mesa = mesas.find(m => m.numero === numero);
    mesaSeleccionada = mesa;
    document.getElementById('mesa-seleccionada').textContent = mesa.numero;
    orden = [...mesa.orden];
    actualizarOrden();
    showScreen('toma-ordenes-screen');
}

function showProducts(categoria) {
    const productsDiv = document.getElementById('products');
    productsDiv.innerHTML = '';
    productos[categoria].forEach(producto => {
        const productDiv = document.createElement('div');
        productDiv.className = 'product';
        productDiv.textContent = producto;
        productDiv.onclick = () => agregarProducto(producto);
        productsDiv.appendChild(productDiv);
    });
}

function agregarProducto(producto) {
    const index = orden.findIndex(item => item.nombre === producto);
    if (index > -1) {
        orden[index].cantidad += 1;
    } else {
        orden.push({ nombre: producto, cantidad: 1 });
    }
    actualizarOrden();
}

function disminuirCantidad(producto) {
    const index = orden.findIndex(item => item.nombre === producto);
    if (index > -1) {
        orden[index].cantidad -= 1;
        if (orden[index].cantidad === 0) {
            orden.splice(index, 1);
        }
    }
    actualizarOrden();
}

function actualizarOrden() {
    const ordenList = document.getElementById('orden-list');
    ordenList.innerHTML = '';
    orden.forEach(item => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            ${item.nombre} - ${item.cantidad}
            <div class="quantity-controls">
                <button onclick="disminuirCantidad('${item.nombre}')">-</button>
                <button onclick="agregarProducto('${item.nombre}')">+</button>
            </div>
        `;
        ordenList.appendChild(listItem);
    });
}

function confirmarOrden() {
    mesaSeleccionada.ocupada = true;
    mesaSeleccionada.orden = [...orden];
    mostrarMesas();

    const confirmacionList = document.getElementById('confirmacion-list');
    confirmacionList.innerHTML = '';
    orden.forEach(item => {
        const listItem = document.createElement('li');
        listItem.textContent = `${item.nombre} - ${item.cantidad}`;
        confirmacionList.appendChild(listItem);
    });
    showScreen('confirmacion-screen');
}

function enviarCocina() {
    // Aquí iría la lógica para enviar la orden a la cocina
    alert('Orden enviada a la cocina');
    showScreen('cocina-screen');
}

function autorizar() {
    const authCode = document.getElementById('auth-code').value;
    if (authCode === '1234') { // Simulación de código de autorización
        alert('Autorización exitosa');
        showScreen('toma-ordenes-screen');
    } else {
        alert('Código incorrecto');
    }
}

// Inicializar con la pantalla de inicio de sesión activa
document.addEventListener('DOMContentLoaded', () => {
    showScreen('login-screen');
    mostrarMesas();
});
