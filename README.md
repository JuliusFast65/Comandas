# Comandas

Aplicación web con servidor Node.js y PostgreSQL 17. Los navegadores acceden a la API; la base de datos no se expone a los clientes. El catálogo original y las nueve mesas se conservan.

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

Abrir `http://localhost:3000`. La inicialización crea las cuentas `admin`, `mesero`, `cocina`, `bar` y `caja`, con la contraseña definida en `SEED_PASSWORD`. Es un conjunto inicial de prueba: asignar cuentas personales y contraseñas distintas antes de operar. Ejecutar nuevamente `db:init` conserva los datos y no cambia contraseñas existentes.

En el entorno de desarrollo de este hilo ya se generó `.env`, se inicializó PostgreSQL y se arrancó el servidor. No guardar `.env` en Git.

## Varios clientes

El backend escucha en `0.0.0.0:3000`. En una instalación dentro del restaurante, abrir `http://IP-DEL-SERVIDOR:3000` desde cada dispositivo conectado a la red local. Configurar `APP_ORIGIN` con esa dirección exacta (incluido el puerto), o eliminar esa variable para acceso directo sin proxy. Todos deben usar el mismo servidor y base de datos.

Para probar roles simultáneos en una sola computadora, usar perfiles de navegador separados o distintos navegadores. Las pestañas de un mismo perfil comparten la cookie de sesión. Cerrar sesión en un dispositivo no cierra las sesiones de otros dispositivos.

## Flujo implementado

- Mesero: abrir una mesa o un pedido para llevar, añadir productos y notas por cuenta, editar productos sin enviar, enviar a cocina/bar y solicitar la cuenta.
- Cocina y bar: recibir sus productos enviados y marcarlos listos.
- Caja: guardar datos del cliente por cuenta y cerrar el pedido cuando todos sus productos estén listos.
- Administrador: acceder a todas las áreas.
- Caja y administrador: consultar los últimos 100 pedidos cerrados; el historial completo permanece en PostgreSQL.

Los pedidos usan UUID y una numeración común. Los cambios se realizan en transacciones, con bloqueo por pedido y control de versión: una modificación basada en datos antiguos recibe un conflicto y el cliente actualiza sus datos. Un índice impide dos pedidos activos para la misma mesa. Al cerrar una cuenta se conserva el pedido y sus productos, y la mesa queda disponible.

Las notificaciones PostgreSQL (`LISTEN/NOTIFY`) se transmiten mediante eventos SSE. Los clientes reconectan automáticamente y consultan el estado cada 15 segundos para recuperar eventos perdidos. La sesión se guarda en PostgreSQL, dura 12 horas y usa una cookie HttpOnly. Las contraseñas se almacenan con scrypt y los tokens de sesión se guardan como hashes. Los permisos se validan en cada operación del servidor; cocina y bar no reciben los datos del cliente.

## Validación

```sh
npm test
```

Las pruebas crean una base PostgreSQL temporal, inicializan las cuentas y comprueban el flujo entre roles, acceso no autorizado, conflictos concurrentes, privacidad de datos, notificaciones, cierre, historial y reinicio del servidor HTTP. La conexión de pruebas necesita permiso para crear y eliminar esa base; usar una instancia de desarrollo, no producción.

También se verificó en Chromium el flujo completo con cuatro perfiles aislados: envío y recepción automática en cocina/bar, cierre en caja, historial, recargas y cierre de sesión independiente. No hubo errores de JavaScript.

## Instalación real

Esta es la primera base funcional, no una instalación publicada. Puede usar un PostgreSQL externo configurando `DATABASE_URL`. El volumen `postgres_data` conserva la información al reiniciar el contenedor. No ejecutar `docker compose down -v` si se necesitan los datos: elimina el volumen.

Para acceso desde Internet, configurar dominio y HTTPS en un proxy inverso, `APP_ORIGIN` con el origen público y `COOKIE_SECURE=true`; permitir SSE sin almacenamiento intermedio. Ejecutar el backend como servicio supervisado. La conexión local a PostgreSQL se publica solo en `127.0.0.1`; usar un usuario de base con permisos mínimos para el backend y otro para inicialización/migraciones. Configurar y verificar copias de seguridad con `pg_dump` y restauraciones antes de operar. El servidor dentro de la red local funciona sin Internet; no hay modo de trabajo desconectado del servidor.

Esta entrega guarda pedidos y datos por cuenta, pero no calcula precios, impuestos ni pagos y no emite facturas fiscales. También quedan pendientes gestión de usuarios desde la interfaz, cambios de contraseña, cancelación de pedidos y administración del catálogo. La interfaz de prueba se adaptó al flujo compartido; `styles.css` conserva los estilos anteriores.
