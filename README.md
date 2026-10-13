# Comandas

Aplicación web con servidor Node.js y PostgreSQL 17. Los navegadores acceden a la API; la base de datos no se expone a los clientes. El catálogo y las mesas iniciales son datos de demostración que el administrador modifica desde la aplicación.

## Puesta en marcha

Requisitos: Node.js 22 o superior, npm y Docker con Compose, o una instancia PostgreSQL administrada.

1. Copiar `.env.example` a `.env`.
2. Reemplazar `POSTGRES_PASSWORD`, actualizar también esa contraseña en `DATABASE_URL`, y definir `SEED_PASSWORD` con al menos 12 caracteres. No usar los valores de ejemplo.
3. Ejecutar:

```sh
docker compose up -d db
npm ci
npm run db:init
npm start
```

Abrir `http://localhost:3000`. La inicialización crea las cuentas `admin`, `supervisor`, `mesero`, `mesero1`, `mesero2`, `cocina`, `bar`, `caja` y `auditor`, con la contraseña definida en `SEED_PASSWORD`, que es temporal: cada cuenta debe reemplazarla por una propia en su primer ingreso y no puede operar hasta hacerlo. Entrar primero como `admin` y cambiar su contraseña al instalar. Las contraseñas existentes se conservan; no se restaura la contraseña `1234` de la antigua demo. Ejecutar nuevamente `db:init` aplica las migraciones sin eliminar pedidos ni cambiar las tarifas ya guardadas.

En el entorno de desarrollo de este hilo ya se generó `.env`, se inicializó PostgreSQL y se arrancó el servidor. No guardar `.env` en Git.

## Usuarios y contraseñas

La migración 8 marca todas las cuentas existentes para cambiar la contraseña en el próximo ingreso, porque compartían `SEED_PASSWORD`. Ejecutar `npm.cmd run db:init` y reiniciar el servidor.

- Cada persona cambia su contraseña desde el menú de usuario → **Cambiar contraseña** (mínimo 8 caracteres). El cambio cierra sus sesiones en otros dispositivos.
- El administrador crea usuarios en **Usuarios y permisos** con una contraseña temporal, la restablece cuando alguien la olvida y desactiva o reactiva cuentas. Restablecer o desactivar cierra las sesiones de esa cuenta. Un administrador no puede desactivar ni restablecer su propia cuenta desde esa pantalla.
- Un usuario con rol Mesero debe estar vinculado a un integrante del equipo de meseros.

## HTTPS en la red local

Por HTTP, las contraseñas y la sesión viajan sin cifrar por el Wi-Fi del restaurante. Comandas puede servir HTTPS directamente, sin proxy:

1. Crear un certificado para la dirección del servidor (ejemplo con OpenSSL, incluido en Git para Windows; reemplazar la IP):

   ```sh
   mkdir certs
   openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=comandas" -addext "subjectAltName=IP:192.168.100.70,DNS:localhost" -keyout certs/comandas.key -out certs/comandas.crt
   ```

2. En `.env`: `TLS_CERT_FILE=certs/comandas.crt`, `TLS_KEY_FILE=certs/comandas.key`, `COOKIE_SECURE=true` y, si se usa, `APP_ORIGIN=https://192.168.100.70:3000`.
3. Reiniciar y abrir `https://IP-DEL-SERVIDOR:3000`. Con HTTPS activo el puerto deja de aceptar HTTP.

Un certificado autofirmado cifra la conexión, pero cada navegador mostrará una advertencia hasta instalarlo como de confianza en el dispositivo (o usar una autoridad local como `mkcert`). La carpeta `certs/` no se guarda en Git; la clave privada no debe copiarse fuera del servidor.

## Robustez

- Cocina, bar y meseros pueden trabajar a la vez sobre la misma mesa: añadir productos, marcar preparado y retirar ya no producen el aviso «Otro usuario modificó el pedido». Ese control se mantiene para los cambios que reemplazan datos (editar cantidades o notas, enviar, cuentas, cobro, cierre).
- Enviar una cuenta a LSoft cierra solo esa cuenta. Las demás cuentas de la mesa, y las cuentas nuevas, siguen pidiendo y enviando rondas hasta que todas estén enviadas; después se continúa con «Abrir nuevo consumo».

- Si PostgreSQL se reinicia o cierra conexiones inactivas, el servidor registra el aviso y continúa; las conexiones se restablecen en la siguiente operación.
- Los toques seguidos sobre un producto o sobre los botones de cantidad se guardan en orden, uno tras otro, sin descartarse. Las demás operaciones (enviar, pedir cuenta, liberar) siguen ignorando un segundo toque mientras la primera está en curso.

## Anulaciones y correcciones después de enviar

Ejecutar `npm.cmd run db:init` para aplicar la migración 9 y reiniciar el servidor. En **Detalle de la orden**, cada producto ya enviado ofrece:

- **Anular**: retira una cantidad de la cuenta, con motivo obligatorio. El mesero responsable puede anular mientras el producto está en preparación; si ya está preparado o retirado, solo el supervisor o el administrador. La cantidad anulada sale del consumo y de los totales, y queda registrada con su importe, motivo, usuario y hora. La estación ve el aviso **ANULADO** hasta pulsar «Enterado».
- **Nota**: cambia la nota mientras el producto está en preparación; la estación lo ve marcado como «Nota modificada».
- **Mover**: pasa una cantidad a otra cuenta de la misma mesa, conservando su estado de preparación.
- **Cambiar a mesa**: traslada el pedido completo a una mesa libre.

Una cuenta ya enviada a LSoft no admite correcciones; las demás cuentas de la mesa sí. Si se anula todo, la mesa se libera con «Liberar mesa» (o el pedido para llevar con su botón de eliminar) y el pedido queda en el historial con sus anulaciones.

## Catálogo y mesas

Ejecutar `npm.cmd run db:init` para aplicar la migración 10 y reiniciar el servidor. El administrador usa **Catálogo y mesas**:

- **Categorías**: crear, renombrar, ordenar y ocultar del menú.
- **Productos y precios**: crear productos; editar nombre, categoría, estación de preparación y disponibilidad; escribir varios precios y guardarlos juntos. El precio pertenece a cada producto: dos productos con el mismo nombre en categorías distintas ya no comparten precio.
- **Mesas**: crear mesas con número y zona opcional, y desactivarlas o reactivarlas. Una mesa con pedido activo no se puede desactivar.

Nada se elimina: los productos, categorías y mesas que dejan de usarse se desactivan y siguen en el historial. Los cambios afectan a lo que se pida después; los productos ya pedidos conservan su nombre, tarifa y estación. La migración traslada a cada producto el precio que tenía (los guardados en la configuración por nombre, o el de demostración de su categoría). `db:init` solo carga el catálogo de demostración cuando no existe ningún producto, de modo que no repone productos renombrados. IVA, servicio y la interpretación de precios siguen en **Configuración**.

## Auditoría

- Cada cambio de un pedido guarda quién, cuándo y qué: producto, cantidades, cuenta, notas anteriores y nuevas, motivo e importe de las anulaciones, traslados y reasignaciones. Supervisor, caja, auditor y administrador lo consultan con **Ver bitácora** y en cada operación cerrada.
- **Auditoría** (administrador y auditor) muestra los últimos 300 registros, con filtros para anulaciones y correcciones, pedidos, o accesos y administración: ingresos e intentos fallidos, cambios y restablecimientos de contraseña, altas y bajas de usuarios, estaciones, precios y equipo de meseros. Nunca se guardan contraseñas.
- Los pedidos para llevar vacíos que se eliminan dejan su rastro en el registro administrativo.
- Los registros anteriores a la migración 9 conservan solo el nombre de la acción.

El límite de intentos de ingreso (40 cada 15 minutos por dirección) cuenta solo los fallidos, de modo que varios dispositivos detrás de una misma dirección no se bloquean entre sí.

## Varios clientes

La fase 1 de estaciones usa la migración 5: `stations` guarda las estaciones y
`user_stations` vincula usuarios con una o varias estaciones, independientemente
de su rol. Las cuentas existentes de Cocina y Bar pasan al rol `estacion`,
manteniendo sus identificadores, contraseñas y sesiones, con su estación original
asignada. Los campos `area` de productos y pedidos conservan sus valores e historial
y ahora referencian `stations`. El permiso de preparación se valida por asignación
a una estación activa; el administrador mantiene acceso a ambas.

Ejecutar `npm.cmd run db:init` antes de arrancar esta versión. Repetirlo conserva
las asignaciones existentes. Esta fase mantiene las pantallas de Cocina y Bar;
el rol Supervisor corresponde a la siguiente fase.

La fase 2 permite al administrador crear, renombrar, desactivar y reactivar
estaciones desde **Configuración → Estaciones y productos**. Los productos se
seleccionan individualmente o por categoría y se asignan a una estación activa.
Cambiar el destino afecta únicamente a los productos añadidos después del cambio;
los borradores, pedidos enviados y el historial conservan su destino original.
Para desactivar una estación hay que reasignar sus productos y terminar de preparar
y retirar los pendientes. Las estaciones se conservan en la base, sin borrarlas.

En **Usuarios y permisos**, el administrador asigna una o varias estaciones a
cualquier usuario sin cambiar su rol. Un mesero puede atender sus mesas y preparar
los pedidos de Cafetería o Postres, incluso si pertenecen a otro mesero; esto no le
permite editar las mesas ajenas. La asignación se conserva al desactivar una estación
y vuelve a habilitarse al reactivarla. Las pantallas, nombres, resúmenes y retiros por
estación se generan desde la configuración. Los cambios se comparten entre dispositivos
y usan control de versión para impedir que se sobrescriban cambios simultáneos.
Esta fase utiliza la estructura de la migración 5; no requiere otra migración.

La fase 3 incorpora **Supervisor** para el jefe de meseros. Puede atender y
reasignar todas las mesas, coordinar rondas y retiros, gestionar precuentas y
consultar el historial. Al abrir un pedido elige su mesero responsable. Preparar
productos requiere una estación asignada, igual que para los demás usuarios.
El supervisor no administra precios, estaciones, usuarios ni la lista de meseros,
ni recibe los permisos exclusivos de Caja para registrar documentos o pagos.

El administrador cambia entre Mesero y Supervisor desde **Usuarios y permisos →
Rol en el salón**. Se conservan el usuario, su contraseña, sesiones, vínculo con
el mesero y estaciones. Los permisos cambian en la sesión existente. Para volver
a Mesero debe existir un mesero vinculado. `npm.cmd run db:init` aplica la migración
6 y crea la cuenta inicial `supervisor` con `SEED_PASSWORD`, sin alterar las cuentas
existentes. Ejecutarlo nuevamente conserva las asignaciones y los roles elegidos.

El backend escucha en `0.0.0.0:3000`. En una instalación dentro del restaurante, abrir `http://IP-DEL-SERVIDOR:3000` desde cada dispositivo conectado a la red local. Configurar `APP_ORIGIN` con esa dirección exacta (incluido el puerto), o eliminar esa variable para acceso directo sin proxy. Todos deben usar el mismo servidor y base de datos.

Para probar roles simultáneos en una sola computadora, usar perfiles de navegador separados o distintos navegadores. Las pestañas de un mismo perfil comparten la cookie de sesión. Cerrar sesión en un dispositivo no cierra las sesiones de otros dispositivos.

## Flujo implementado

- Mesero: atender sus mesas, usar chips y búsqueda sin distinguir acentos en todo el menú, añadir productos y notas por cuenta, confirmar rondas y enviar a cocina/bar. Retirar una cantidad o todo lo preparado y enviar la precuenta por cuenta al simulador.
- Cocina y bar: marcar sus productos preparados. Preparación y retiro son acciones separadas; los productos totalmente retirados salen de la lista activa y permanecen en la consulta de retirados.
- Administrador: administrar catálogo, precios, mesas, IVA y servicio, mantener el equipo de meseros y los usuarios, y reasignar mesas.
- Mesero responsable, supervisor, caja y administrador: liberar la mesa cuando todas las cuentas estén enviadas a LSoft, los productos estén preparados y los clientes se hayan retirado.
- Auditor: consultar cuentas y operaciones cerradas sin modificar datos.
- Caja, auditor, supervisor y administrador: consultar los últimos 100 pedidos cerrados; el historial completo permanece en PostgreSQL.

La interfaz recupera el diseño de `4c0a111` / `orden-movil-1`, con menú superior, usuario y cierre de sesión, chips, búsqueda expandible, cantidades del borrador por cuenta y revisión móvil del pedido. Los precios iniciales son los valores de demostración de aquella versión. Cada producto conserva la tarifa vigente al añadirlo. Los pedidos PostgreSQL anteriores, que no tenían precios, reciben esa tarifa de demostración una sola vez al migrar. IVA y servicio se calculan sobre la misma base en centavos; pueden estar incluidos o añadirse aparte. La propina voluntaria se registra por cuenta. La precuenta se puede imprimir.

LSoft sigue siendo un **simulador**: no conecta con ListoSoft, DataFast ni SRI y no emite facturas fiscales. El JSON enviado y el estado de recepción se guardan en PostgreSQL. Los reintentos conservan el identificador; una cuenta enviada queda cerrada a nuevas rondas y a la edición de sus datos, y las demás cuentas de la mesa siguen abiertas. El mesero entrega el voucher en caja; el cobro y la firma se realizan físicamente, sin registrarlos en Comandas. Después de enviar todas las cuentas, la mesa permanece ocupada hasta confirmar «Liberar mesa» cuando los clientes se retiren. Esta acción está disponible para el mesero responsable, caja y administrador, requiere productos preparados y conserva el pedido en el historial sin marcarlo pagado. Para llevar se usa «Finalizar pedido». No hay cierre automático por preparación ni pago simulado. Ver [contrato provisional](docs/lsoft-contrato.md).

Los pedidos usan UUID y una numeración común. Los cambios se realizan en transacciones, con bloqueo por pedido y control de versión: una modificación basada en datos antiguos recibe un conflicto y el cliente actualiza sus datos. Un índice impide dos pedidos activos para la misma mesa. Al cerrar una cuenta se conserva el pedido y sus productos, y la mesa queda disponible.

Las notificaciones PostgreSQL (`LISTEN/NOTIFY`) se transmiten mediante eventos SSE. Los clientes reconectan automáticamente y consultan el estado cada 15 segundos para recuperar eventos perdidos. La sesión se guarda en PostgreSQL, dura 12 horas y usa una cookie HttpOnly. Las contraseñas se almacenan con scrypt y los tokens de sesión se guardan como hashes. Los permisos se validan en cada operación del servidor; cocina y bar no reciben los datos del cliente.

## Validación

Abrir una mesa libre solo permite consultar el menú. «Ocupar mesa» confirma que hay clientes y la asigna al mesero, incluso sin pedido; «Liberar mesa» permite terminar esa visita si no hay productos ni consumo enviado. Agregar el primer producto también ocupa la mesa. Si se eliminan todos los productos antes de enviarlos, la mesa vuelve a libre salvo que se haya confirmado «Ocupar mesa». Las visitas liberadas conservan sus eventos en el historial. Ejecutar `npm.cmd run db:init` para aplicar la migración 7 sin borrar datos y reiniciar el servidor.

El catálogo ofrece ayuda con el botón ⓘ: ingredientes, preparación habitual y acompañamientos. Las fichas iniciales de entradas, platos, postres y adicionales son ejemplos ficticios identificados en la ventana. El administrador puede editarlas allí; las fichas guardadas se comparten en PostgreSQL y se conservan al cambiar precios. Las notas del pedido siguen siendo instrucciones ingresadas por el usuario. En las órdenes destacan cantidad, plato y notas; precios y totales quedan como información secundaria.

```sh
npm test
```

Las pruebas crean una base PostgreSQL temporal y comprueban roles, privacidad, conflictos concurrentes, retiros parciales y por área, rondas adicionales, tarifas conservadas, configuración compartida, asignaciones, reintentos de LSoft, pagos, cierre, historial, migraciones repetibles y reinicio HTTP. También verifican cálculos y redondeos de la precuenta. La conexión de pruebas necesita permiso para crear y eliminar esa base; usar una instancia de desarrollo, no producción.

También se verificó la interfaz restaurada en Chromium (Edge), con cinco perfiles aislados y tamaños móvil y escritorio: chips y búsqueda, revisión del pedido, preparación por estación, retiro parcial y total, recarga, precuenta de varias cuentas, recepción y pago simulado, cierre e historial, configuración de precios y equipo de meseros. No hubo errores de JavaScript ni desbordamiento horizontal en la toma de pedidos o los controles de retiro.

## Instalación real

Esta es la primera base funcional, no una instalación publicada. Puede usar un PostgreSQL externo configurando `DATABASE_URL`. El volumen `postgres_data` conserva la información al reiniciar el contenedor. No ejecutar `docker compose down -v` si se necesitan los datos: elimina el volumen.

Para acceso desde Internet, configurar dominio y HTTPS en un proxy inverso, `APP_ORIGIN` con el origen público y `COOKIE_SECURE=true`; permitir SSE sin almacenamiento intermedio. Ejecutar el backend como servicio supervisado. La conexión local a PostgreSQL se publica solo en `127.0.0.1`; usar un usuario de base con permisos mínimos para el backend y otro para inicialización/migraciones. Configurar y verificar copias de seguridad con `pg_dump` y restauraciones antes de operar. El servidor dentro de la red local funciona sin Internet; no hay modo de trabajo desconectado del servidor.

Quedan pendientes los descuentos y la integración real con LSoft. `styles.css` recupera los estilos de la versión móvil más reciente; `app.css` adapta los controles al servidor. Roboto y los iconos usan los proveedores del diseño anterior; sin Internet se usa la fuente de respaldo y los textos siguen disponibles.
