const productos = {
    entradas: ['Bruschetta', 'Nachos', 'Quesadilla', 'Calamares'],
    platos: ['Pizza', 'Pasta', 'Hamburguesa', 'Ensalada'],
    postres: ['Tarta de Queso', 'Brownie', 'Helado', 'Fruta'],
    bebidas: ['Coca-Cola', 'Jugo de Naranja', 'Agua', 'Cerveza']
};

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
    const ordenList = document.getElementById('orden-list');
    const listItem = document.createElement('li');
    listItem.textContent = producto;
    ordenList.appendChild(listItem);
}

function enviarOrden() {
    const ordenList = document.getElementById('orden-list');
    const confirmacionList = document.getElementById('confirmacion-list');
    confirmacionList.innerHTML = ordenList.innerHTML;
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
