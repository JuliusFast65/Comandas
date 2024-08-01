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
        mesaDiv.onclick = () => seleccionarMesa(mesa.numero, false);
        mesasDiv.appendChild(mesaDiv);
    });

    const paraLlevarDiv = document.getElementById('para-llevar');
    paraLlevarDiv.innerHTML = '';
    paraLlevarOrdenes.forEach(orden => {
        const ordenDiv = document.createElement('div');
        ordenDiv.className = 'mesa';
        ordenDiv.textContent = `Para Llevar ${orden.numero}`;
        ordenDiv.onclick = () => seleccionarMesa(orden.numero, true);
        paraLlevarDiv.appendChild(ordenDiv);
    });
}

function seleccionarMesa(numero, esParaLlevar) {
    if (esParaLlevar) {
        mesaSeleccionada = paraLlevarOrdenes.find(o => o.numero === numero);
        document.getElementById('para-llevar-checkbox').checked = true;
    } else {
        mesaSeleccionada = mesas.find(m => m.numero === numero);
        document.getElementById('para-llevar-checkbox').checked = false;
    }
    
    document.getElementById('mesa-numero').textContent = mesaSeleccionada.numero;
    document.getElementById('mesa-seleccionada').textContent = mesaSeleccionada.numero;
    ordenEnCocina = mesaSeleccionada.ordenes.filter(o => o.estado === 'en cocina').flatMap(o => o.items);
    orden = mesaSeleccionada.ordenes.find(o => o.estado === 'nueva')?.items || [];
    actualizarOrden();
    showScreen('toma-ordenes-screen');
}

function crearParaLlevar() {
    const nuevaOrden = {
        numero: paraLlevarCounter,
        ocupada: false,
        ordenes: [{ estado: 'nueva', items: [] }]
    };
    paraLlevarCounter += 1;
    paraLlevarOrdenes.push(nuevaOrden);
    mostrarMesas();
}

function showProducts(categoria) {
    document.getElementById('categories').style.display = 'none';
    document.getElementById('back-to-categories').style.display = 'block';
    const productsDiv = document.getElementById('products');
    productsDiv.style.display = 'flex';
    productsDiv.innerHTML = '';
    productos[categoria].forEach(producto => {
        const productDiv = document.createElement('div');
        productDiv.className = 'product';
        productDiv.textContent = producto;
        productDiv.onclick = () => agregarProducto(producto);
        productsDiv.appendChild(productDiv);
    });
}

function showCategories() {
    document.getElementById('categories').style.display = 'flex';
    document.getElementById('back-to-categories').style.display = 'none';
    document.getElementById('products').style.display = 'none';
}

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

function abrirModalNota(index) {
    notaIndex = index;
    document.getElementById('nota-texto').value = orden[index].nota || '';
    document.getElementById('nota-modal').style.display = 'block';
}

function cerrarModal() {
    document.getElementById('nota-modal').style.display = 'none';
}

function guardarNota() {
    const nota = document.getElementById('nota-texto').value;
    if (notaIndex !== null) {
        orden[notaIndex].nota = nota;
        actualizarOrden();
    }
    cerrarModal();
}

function actualizarOrden() {
    const ordenList = document.getElementById('orden-list');
    ordenList.innerHTML = '';
    
    ordenEnCocina.forEach(item => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            ${item.nombre} - ${item.cantidad}
            <span class="en-cocina">(En cocina)</span>
        `;
        ordenList.appendChild(listItem);
    });
    
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
    ordenList.scrollTop = ordenList.scrollHeight;
}

function confirmarOrden() {
    const confirmacionList = document.getElementById('confirmacion-list');
    confirmacionList.innerHTML = '';
    
    ordenEnCocina.forEach(item => {
        const listItem = document.createElement('li');
        listItem.textContent = `${item.nombre} - ${item.cantidad} (En cocina)`;
        confirmacionList.appendChild(listItem);
    });
    
    orden.filter(item => !item.enCocina).forEach(item => {
        const listItem = document.createElement('li');
        listItem.textContent = `${item.nombre} - ${item.cantidad}${item.cuenta !== 1 ? ` (Cuenta ${item.cuenta})` : ''}`;
        confirmacionList.appendChild(listItem);
    });
    
    showScreen('confirmacion-screen');
}

function enviarCocina() {
    let ordenNueva = mesaSeleccionada.ordenes.find(o => o.estado === 'nueva');
    if (!ordenNueva) {
        ordenNueva = { estado: 'nueva', items: [] };
        mesaSeleccionada.ordenes.push(ordenNueva);
    }
    ordenNueva.items = orden.filter(item => !item.enCocina).map(item => ({ ...item, enCocina: true }));
    mesaSeleccionada.ordenes.push({ estado: 'en cocina', items: ordenNueva.items });
    mesaSeleccionada.ocupada = true;
    mostrarMesas();
    mostrarCocina();
    alert('Orden enviada a la cocina');
    showScreen('mesas-screen');
}

function cancelarOrden() {
    showScreen('mesas-screen');
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

function actualizarCuentas() {
    cuentas = parseInt(document.getElementById('cuentas').value);
    actualizarOrden();
}

function mostrarCocina() {
    const cocinaList = document.getElementById('cocina-list');
    cocinaList.innerHTML = '';

    [...mesas, ...paraLlevarOrdenes].forEach(mesa => {
        const ordenesCocina = mesa.ordenes.filter(o => o.estado === 'en cocina');
        if (ordenesCocina.length > 0) {
            const ordenDiv = document.createElement('div');
            ordenDiv.className = 'cocina-item';
            ordenDiv.innerHTML = `<h4>Mesa ${mesa.numero}</h4>`;
            
            ordenesCocina.forEach(orden => {
                orden.items.forEach(item => {
                    const itemDiv = document.createElement('div');
                    itemDiv.innerHTML = `
                        <p>${item.nombre} - ${item.cantidad} ${item.nota ? `<br><small>Nota: ${item.nota}</small>` : ''}</p>
                        <select onchange="actualizarEstadoOrden(${mesa.numero}, '${item.nombre}', this.value)">
                            <option value="en preparación" ${item.estado === 'en preparación' ? 'selected' : ''}>En preparación</option>
                            <option value="terminado" ${item.estado === 'terminado' ? 'selected' : ''}>Terminado</option>
                        </select>
                    `;
                    ordenDiv.appendChild(itemDiv);
                });
            });

            cocinaList.appendChild(ordenDiv);
        }
    });
}

function actualizarEstadoOrden(mesaNumero, itemNombre, estado) {
    const mesa = mesas.find(m => m.numero === mesaNumero) || paraLlevarOrdenes.find(m => m.numero === mesaNumero);
    mesa.ordenes.forEach(orden => {
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
    mostrarCocina();
});
