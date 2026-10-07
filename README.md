# Comandas — prototipo de pedidos de restaurante

Aplicación estática en español para probar pedidos, preparación, retiros, precuentas
 e integración LSoft simulada. No requiere compilación ni base de datos de servidor.

## Contexto para continuar

- [Estado, decisiones y pendientes](docs/estado-proyecto.md): leer al abrir otro hilo.
- [Prueba manual de un turno](docs/pruebas-manuales.md): guía por roles.
- [Contrato LSoft provisional](docs/lsoft-contrato.md) y [JSON de ejemplo](docs/lsoft-pedido-ejemplo.json).
- [Instrucciones para agentes](AGENTS.md).

Desarrollo en **codex/comandas-persistencia**. GitHub Pages usa **gh-pages**.
Demo: https://juliusfast65.github.io/Comandas/. La última etiqueta de aplicación
es **Roles 1**; una actualización documental no cambia la demo.

## Probar

Desde la raíz del repositorio:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Abrir el servidor en el navegador local. Todos los usuarios demo usan `1234`:

| Usuario | Pantalla y responsabilidad |
| --- | --- |
| admin | Operación completa, configuración, cobro simulado y cierre |
| mesero1, mesero2 | Mesas propias, pedidos, retiros y precuentas |
| cocina, bar | Su estación; marcar preparación |
| auditor | Consultar LSoft · Caja, JSON y cierres |

El login recuerda el último acceso exitoso, incluida la contraseña de demo.
Enter en Contraseña permite entrar. No inicia sesión automáticamente.
Para probar varios roles, cerrar sesión desde el chip y volver a entrar en el
**mismo navegador**. Los datos no se comparten entre dispositivos.

## Funcionamiento

- Cuenta 1 es la predeterminada. Cambiar cuenta antes de añadir asigna los productos
  nuevos a otra persona; no mueve productos anteriores.
- Categorías persistentes, buscador global sin distinguir tildes ni mayúsculas,
  y tarjetas con cantidades del borrador de la cuenta seleccionada.
- Confirmar envía alimentos a Cocina y bebidas a Bar. La estación marca Preparado;
  el mesero retira cantidades o todo lo listo de su mesa.
- Mesa azul: falta preparar. Naranja: hay algo listo para retirar y tiene prioridad.
  Verde: todo lo enviado se retiró. Adicionales y cuenta pedida se indican con texto.
- Líneas retiradas desaparecen de la estación; Ver retirados consulta pedidos
  actuales y se limpia al cerrar la orden.
- Nombre y badge identifican al mesero de la mesa. El chip superior identifica al
  usuario. El administrador puede configurar nombres y reasignar responsables;
  el mesero usa su identidad de login. Cerrar la mesa libera su asignación.

## Precios, precuenta y LSoft

En el menú hamburguesa del administrador se encuentran Precios y cargos,
Equipo de meseros y Usuarios de demostración. La lista de meseros no crea accesos
nuevos: los usuarios demo están definidos en código.

Los precios iniciales son de demostración. IVA 15% y servicio 10% por defecto,
configurables; servicio 0 lo desactiva. IVA y servicio usan la misma base: **el IVA
no grava el servicio**. Propina voluntaria aparte. Los precios pueden incluir
cargos o ser base más cargos. Cambiar el modo conserva los números y cambia su
interpretación. Productos ya añadidos conservan su tarifa; pedidos antiguos sin
precio reciben valores de demo al activar esa versión. Se calcula en centavos.

**Pedir Cuenta → consumo → datos y propina → Enviar cuenta a LSoft (simulado)**.
Cada cuenta se envía directamente desde su precuenta. Imprimir permite usar datos
completados o campos vacíos para llenarlos en papel; PDF depende del dispositivo.

**LSoft · Caja** muestra cuentas enviadas y errores. Permite consultar el estado
 y revisar el JSON provisional; las acciones dependen del rol. Como admin, elegir
medio de pago y Simular cobro en LSoft. Solo después del pago de todas las cuentas
se permite Cerrar mesa pagada. Se conserva una operación en el historial de cierres.
Los reintentos no duplican Pedidos. El envío bloquea nuevas rondas y edición de
los datos enviados; la actualización de pedidos del ERP sigue pendiente de diseño.

## Persistencia y límites

Pedidos, clientes, propinas, configuración, simulador y cierres quedan en
localStorage de este navegador y origen. No hay servidor, sincronización,
autenticación real ni integración con SQL, LSoft, SRI o DataFast. No se procesan
pagos reales ni se emiten comprobantes fiscales. Usar datos ficticios en la demo.
Los permisos de interfaz y funciones sirven para probar flujos, no para proteger
operaciones frente a manipulación del navegador.

## Comprobaciones

En el entorno Codex preparado, desde la raíz del checkout:

```sh
NODE_PATH=/workspace/.comandas-tools/node_modules node --test tests/persistence.cjs
node --check scripts.js
```

La suite tiene 25 casos al documentar Roles 1. Ejercita DOM y lógica con jsdom;
no sustituye pruebas visuales, impresión física ni API real.

En una máquina que no tenga esas herramientas, instalar fuera del checkout:

```sh
mkdir -p /tmp/comandas-test-tools
npm install --prefix /tmp/comandas-test-tools --cache /tmp/comandas-npm-cache --no-audit --no-fund --save-exact jsdom@26.1.0
NODE_PATH=/tmp/comandas-test-tools/node_modules node --test tests/persistence.cjs
```

El entorno original también conserva `/workspace/.comandas-tools/smoke.cjs` para
comprobar assets HTTP y el recorrido de pedidos con el servidor en puerto 8000.
Es un helper del entorno, no un archivo versionado del repositorio.

## Preview autónomo

Algunas vistas previas de archivos HTML no resuelven CSS/JS externos. Generar una
copia con ambos incluidos, sin modificar la aplicación:

```sh
python3 tools/build-preview.py /tmp/Comandas-preview.html
```

Abrir ese archivo en un navegador. La interfaz que lo muestra podría limitar
JavaScript; GitHub Pages sirve la aplicación completa. Fuentes e iconos externos
son opcionales y requieren Google Fonts y Cloudflare CDN.

## Publicación

GitHub: **Settings → Pages → Deploy from a branch → gh-pages / (root)**.
La rama pública contiene solo `index.html`, `scripts.js` y `styles.css`.
No publicar `.vs`, documentos, herramientas, credenciales ni datos de clientes.

Con cada cambio publicado de aplicación, actualizar las versiones de CSS/JS y la
etiqueta de demo del HTML. Revisar el último despliegue en GitHub Actions antes de
considerar la web actualizada. No borrar pedidos locales para resolver caché.
