# Comandas — demo de pedidos de restaurante

Prototipo estático en español. Acceso de demostración: **admin / 1234**.
El último acceso exitoso se recuerda en este navegador (incluida la contraseña
de demostración); no inicia sesión automáticamente. Enter en Contraseña permite entrar.
No requiere compilación ni servidor de base de datos.

## Probar

Sirve esta carpeta con `python3 -m http.server 8000` y abre el servidor en tu navegador local.
Entra, selecciona Mesa 1, añade una Pizza y una bebida, confirma y envía a preparación.
Recarga, vuelve a entrar y comprueba que la mesa sigue ocupada y los productos aparecen
en Cocina y Bar. También puedes crear pedidos para llevar.

## Preparación y retiro

En Cocina o Bar marca **Preparado** cuando el producto esté listo. Aparecerá un
campo para elegir cuántas unidades se retiran y el botón **Retirar**. El botón
**Retirar todo lo listo** de esa sección retira solo los productos preparados de
esa mesa en Cocina o Bar. Dentro de la mesa hay otro botón que retira todo lo
listo de ambas áreas. Lo que sigue en preparación no se retira.

Las mesas ocupadas usan tres colores: azul si falta preparar y no hay nada listo,
naranja si hay algo listo para retirar (tiene prioridad) y verde cuando todo lo
enviado se retiró. El texto muestra las cantidades pendientes. Los pedidos enviados
después de la primera ronda se identifican como adicionales. La cuenta pedida lleva
una etiqueta independiente del color. El retiro registra la salida hacia la mesa,
no la entrega al cliente. Después de retirar unidades, no se puede desmarcar
**Preparado** en esa línea.

Los pedidos, notas y nombres de cuentas se guardan en el almacenamiento local del
navegador. Los datos personales del formulario de facturación no se guardan.
Cada navegador y dirección web mantiene sus propios datos: no hay sincronización
entre dispositivos. El inicio de sesión es una simulación y no protege la aplicación.
La facturación es demostrativa; no emite comprobantes fiscales.

## Comprobaciones

En Mesas selecciona **Estoy atendiendo como…**. Al abrir una mesa sin responsable,
se asigna a ese mesero. La tarjeta muestra nombre e iniciales. Dentro de la mesa
puedes cambiar el responsable. **Mis mesas y libres sin asignar** oculta las de otros
meseros y deja disponibles las libres. En **Configurar meseros** edita un nombre por
línea. Esta lista y el mesero activo son locales al navegador, no usuarios autenticados.
Cerrar la orden libera también la asignación del mesero.

Al pedir cuenta se muestra una precuenta por cada cuenta con productos enviados y
cantidades. Completa los datos y una propina voluntaria, o imprime con los campos
vacíos para llenarlos en papel. La impresión usa el diálogo del navegador y permite
guardar como PDF cuando el dispositivo lo ofrece. Los precios iniciales son de demostración. En **Configurar precios y cargos**,
edita el menú, el IVA (15% por defecto), servicio (10%, o 0 para desactivarlo),
y si los precios incluyen cargos o son base más cargos. IVA y servicio usan
la misma base: el IVA no grava el servicio. Los cálculos usan centavos y
el precio final incluido se conserva asignando el ajuste de redondeo al servicio.
Cada producto conserva la tarifa con la que se añadió; la configuración solo
afecta a productos nuevos. Los pedidos de versiones sin precios reciben
las tarifas de demostración al activar esta versión. La configuración es local al navegador. Los datos de facturación y la
propina se conservan solo durante la sesión abierta, no al recargar. Guardarlos no
libera la mesa; el cierre se realiza en Caja.

En el entorno Codex preparado:

```sh
NODE_PATH=/workspace/.comandas-tools/node_modules node --test tests/persistence.cjs
node --check scripts.js
node /workspace/.comandas-tools/smoke.cjs
```

El último comando requiere el servidor en el puerto 8000. Para ejecutar las pruebas
en otra máquina, instala `jsdom@26.1.0` en una carpeta externa al repositorio y apunta
`NODE_PATH` a su `node_modules`.

## GitHub Pages

La rama `gh-pages` contiene exclusivamente los archivos públicos de la demo.
En GitHub abre **Settings → Pages → Deploy from a branch**, selecciona
**gh-pages / (root)** y guarda. GitHub mostrará la dirección cuando finalice el despliegue.
No subas la carpeta `.vs`, datos de clientes ni credenciales al sitio.

Las fuentes y los iconos dependen de Google Fonts y Cloudflare CDN. El flujo de pedidos
puede usarse sin ellos. Esta demo sirve para evaluar el prototipo, no para operar
un restaurante con múltiples usuarios.
