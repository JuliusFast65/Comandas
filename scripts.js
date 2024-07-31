const productos = {
    entradas: ['Bruschetta', 'Nachos', 'Quesadilla', 'Calamares'],
    platos: ['Pizza', 'Pasta', 'Hamburguesa', 'Ensalada'],
    postres: ['Tarta de Queso', 'Brownie', 'Helado', 'Fruta'],
    bebidas: ['Coca-Cola', 'Jugo de Naranja', 'Agua', 'Cerveza']
};

let orden = [];

function showScreen(screenId) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
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

function eliminarProducto(producto) {
    orden = orden.filter(item => item.nombre !== producto);
    actualizarOrden();
}

function actualizarOrden() {
    const ordenList = document.getElementById('orden-list');
    ordenList.innerHTML = '';
    orden.forEach(item => {
        const listItem = document.createElement('li');
        listItem.textContent = `${item.nombre} - Cantidad: ${item.cantidad}`;
        const eliminarBtn = document.createElement('button');
        eliminarBtn.textContent = 'Eliminar';
        eliminarBtn.onclick = () => eliminarProducto(item.nombre);
        listItem.appendChild(eliminarBtn);
        ordenList.appendChild(listItem);
    });
}

function enviarOrden() {
    const confirmacionList = document.getElementById('confirmacion-list');
    confirmacionList.innerHTML = '';
    orden.forEach(item => {
        const listItem = document.createElement('li');
        listItem.textContent = `${item.nombre} - Cantidad: ${item.cantidad}`;
        confirmacionList.appendChild(listItem);
    });
    showScreen('confirmacion-screen');
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
});
