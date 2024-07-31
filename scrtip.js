function showScreen(screenId) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function agregarProducto() {
    const producto = prompt("Nombre del producto:");
    if (producto) {
        const ordenList = document.getElementById('orden-list');
        const listItem = document.createElement('li');
        listItem.textContent = producto;
        ordenList.appendChild(listItem);
    }
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
