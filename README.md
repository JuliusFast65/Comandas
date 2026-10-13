# Comandas

Aplicación web para tomar pedidos en un restaurante: salón, estaciones de preparación, caja y administración. Un servidor Node.js atiende a los navegadores y guarda todo en PostgreSQL 17; la base de datos no se expone a los dispositivos.

La facturación es un **simulador**: Comandas no se conecta con ListoSoft (LSoft), DataFast ni el SRI, y no emite facturas fiscales. Ver el [contrato provisional](docs/lsoft-contrato.md).

## Contenido

- [Puesta en marcha](#puesta-en-marcha)
- [Actualizar una instalación](#actualizar-una-instalación)
- [Roles](#roles)
- [Uso](#uso)
- [Administración](#administración)
- [Instalación en el restaurante](#instalación-en-el-restaurante)
- [Operación](#operación)
- [Seguridad y consistencia](#seguridad-y-consistencia)
- [Desarrollo](#desarrollo)
- [Limitaciones conocidas](#limitaciones-conocidas)

## Puesta en marcha

Requisitos: Node.js 22 o superior, npm y Docker con Compose (o un PostgreSQL 17 propio). En Windows, usar `npm.cmd` en lugar de `npm`.

1. Copiar `.env.example` a `.env`.
2. Reemplazar `POSTGRES_PASSWORD` y la misma contraseña dentro de `DATABASE_URL`. Definir `SEED_PASSWORD` con al menos 12 caracteres. No usar los valores de ejemplo ni guardar `.env` en Git.
3. Ejecutar:

   ```sh
   docker compose up -d db
   npm ci
   npm run db:init
   npm start
   ```

4. Abrir `http://localhost:3000`, entrar como `admin` con `SEED_PASSWORD` y definir su contraseña.

`db:init` crea las cuentas `admin`, `supervisor`, `mesero`, `mesero1`, `mesero2`, `cocina`, `bar`, `caja` y `auditor`. Todas comparten `SEED_PASSWORD` como contraseña **temporal**: cada cuenta debe reemplazarla en su primer ingreso y no puede operar hasta hacerlo. También carga un catálogo y nueve mesas de demostración, que el administrador modifica después desde la aplicación.

### Variables de `.env`

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión del servidor a PostgreSQL. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Credenciales del contenedor de PostgreSQL. |
| `SEED_PASSWORD` | Contraseña temporal de las cuentas iniciales. La exige `db:init`. |
| `PORT`, `HOST` | Puerto y dirección de escucha (por defecto `3000` y `0.0.0.0`). |
| `APP_ORIGIN` | Dirección exacta que ven los navegadores, con puerto. Necesaria detrás de un proxy; sin proxy puede omitirse. |
| `COOKIE_SECURE` | `true` cuando se usa HTTPS. |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | Certificado y clave para que el servidor atienda HTTPS. |
| `BACKUP_DIR`, `BACKUP_KEEP` | Carpeta y cantidad de respaldos que conserva `db:backup` (por defecto `backups` y 30). |

## Actualizar una instalación

```sh
npm run db:backup
npm ci
npm run db:init
```

Luego reiniciar el servidor. `db:init` aplica solo las migraciones que falten (`server/migrations`), dentro de una transacción, y conserva pedidos, usuarios, contraseñas, precios y asignaciones. El servidor se niega a arrancar si la base no tiene la última migración.

Cambios que conviene conocer al actualizar desde versiones antiguas:

- Migración 8: todas las cuentas existentes deben cambiar su contraseña en el siguiente ingreso.
- Migración 10: el precio pasa a pertenecer a cada producto. Se conserva el que tenía, pero dos productos con el mismo nombre en categorías distintas dejan de compartirlo.
- Los registros de bitácora anteriores a la migración 9 conservan solo el nombre de la acción.

## Roles

| Rol | Puede |
|---|---|
| Mesero | Atender sus mesas y las libres, tomar pedidos, enviar rondas, retirar lo preparado, pedir la cuenta, corregir sus pedidos y liberar la mesa. |
| Supervisor | Lo mismo en todas las mesas, reasignar el mesero responsable, anular productos ya preparados, aplicar descuentos y consultar historial y bitácoras. |
| Personal de estación | Ver los pedidos de sus estaciones (Cocina, Bar u otras) y marcarlos preparados. No recibe datos de clientes. |
| Caja | Registrar los datos de facturación, enviar cuentas al simulador, confirmar la recepción de documentos, liberar mesas y consultar historial y bitácoras. |
| Auditor | Consultar caja, operaciones cerradas y auditoría, sin modificar nada. |
| Administrador | Todo lo anterior y la administración: usuarios, estaciones, catálogo, precios, mesas, cargos y equipo de meseros. |

Las estaciones se asignan a cualquier usuario sin cambiar su rol: un mesero puede, además, preparar los pedidos de Cafetería. El administrador puede operar todas las estaciones activas.

## Uso

### Salón

- **Mesas**: una mesa libre solo muestra el menú. «Ocupar mesa» confirma que hay clientes aunque todavía no pidan; añadir el primer producto también la ocupa. Si se quitan todos los productos antes de enviarlos, la mesa vuelve a quedar libre, salvo que se haya ocupado expresamente.
- **Pedido**: categorías, búsqueda sin distinguir acentos, cuentas separadas con nombre, notas por producto y ficha ⓘ con ingredientes y preparación. Los toques seguidos sobre un producto o sobre los botones de cantidad se guardan todos, en orden.
- **Rondas**: «Enviar a Preparación» manda los productos nuevos a sus estaciones. Las rondas posteriores se marcan como adicionales.
- **Retiro**: cuando la estación marca un producto como preparado, el mesero registra el retiro de una cantidad o de todo lo listo.
- **Para llevar**: pedidos sin mesa, que se finalizan en lugar de liberar una mesa.

### Correcciones después de enviar

En **Detalle de la orden**, cada producto ya enviado ofrece:

- **Anular**: retira una cantidad de la cuenta, con motivo obligatorio. El mesero responsable puede hacerlo mientras el producto está en preparación; si ya está preparado o retirado, solo el supervisor o el administrador. La estación ve el aviso **ANULADO** hasta pulsar «Enterado».
- **Nota**: cambia la nota mientras el producto está en preparación; la estación lo ve como «Nota modificada».
- **Mover**: pasa una cantidad a otra cuenta de la misma mesa.
- **Cambiar a mesa**: traslada el pedido completo a una mesa libre.

Si se anula todo, la mesa se libera con «Liberar mesa» y el pedido queda en el historial con sus anulaciones.

### Estaciones

- Cada estación ve sus productos pendientes, ordenados por antigüedad y con el tiempo transcurrido, y los marca como preparados.
- **Aviso sonoro** (activado por defecto): suena al llegar una ronda, al cambiar una nota y al anularse un producto. Lo que ya estaba en pantalla al abrirla no suena. El navegador solo permite el sonido después de un primer toque en la página, por ejemplo al iniciar sesión.
- **Imprimir comanda**: imprime los productos en preparación de un pedido para esa estación, sin precios.
- **Imprimir comandas al llegar** (desactivado por defecto): imprime cada ronda nueva. El navegador muestra su diálogo de impresión; para imprimir sin diálogo en una impresora de tickets, abrir Chrome o Edge con `--kiosk-printing` y dejar esa impresora como predeterminada.

Las dos preferencias se guardan en cada dispositivo.

### Cuenta y caja

1. El mesero pide la cuenta. Caja ve resaltadas las solicitudes y cualquiera de los dos imprime la precuenta, con espacio para los datos y la firma del cliente.
2. El mesero confirma la entrega de la precuenta y, después, el cobro físico (DataFast) y la recogida de la precuenta firmada y el voucher.
3. Caja confirma que recibió los documentos, registra los datos del cliente y envía la cuenta al simulador de LSoft. Al escribir una cédula o RUC ya usada se recuperan los datos anteriores del cliente.
4. Con todas las cuentas enviadas y los productos preparados, la mesa se libera cuando los clientes se retiran, o se abre un nuevo consumo en la misma mesa si el cobro está confirmado.

Reglas de la cuenta:

- IVA y servicio se calculan sobre la misma base, en centavos enteros. Los precios pueden incluirlos o añadirlos aparte. La propina voluntaria se registra por cuenta y no forma parte de esas bases.
- Cada producto conserva el precio y los cargos vigentes cuando se pidió.
- **Descuentos**: el supervisor o el administrador aplican un porcentaje o un monto fijo por cuenta, con motivo, desde la precuenta. Base, IVA y servicio bajan en la misma proporción. Se puede cambiar o quitar hasta enviar la cuenta.
- Enviar una cuenta la cierra: no admite más rondas, correcciones ni cambios de datos. Las demás cuentas de la mesa, y las nuevas, siguen abiertas hasta que todas estén enviadas.
- El cobro y la firma ocurren físicamente; Comandas solo registra las confirmaciones, con usuario y hora.

### Historial y auditoría

- **Operaciones cerradas** (caja, auditor, supervisor y administrador): los últimos 100 pedidos cerrados con sus cuentas, anulaciones y bitácora. El historial completo permanece en PostgreSQL.
- **Ver bitácora**: cada cambio de un pedido guarda quién, cuándo y qué: productos, cantidades, cuentas, notas anteriores y nuevas, motivo e importe de anulaciones y descuentos, traslados y reasignaciones.
- **Auditoría** (administrador y auditor): los últimos 300 registros, con filtros para correcciones, pedidos, o accesos y administración. Incluye ingresos e intentos fallidos, contraseñas cambiadas o restablecidas, usuarios, estaciones, catálogo, precios y mesas. Nunca se guardan contraseñas.

## Administración

Todo lo siguiente es del administrador. Nada se elimina: lo que deja de usarse se desactiva y sigue en el historial. Los cambios afectan a lo que se pida después.

- **Usuarios y permisos**: crear usuarios con una contraseña temporal, restablecerla, desactivar o reactivar cuentas (ambas acciones cierran sus sesiones), vincular cada mesero con un integrante del equipo, cambiar entre Mesero y Supervisor y asignar estaciones. Un usuario con rol Mesero debe estar vinculado a un mesero. Cada persona cambia su contraseña desde el menú de usuario (mínimo 8 caracteres), lo que cierra sus otras sesiones.
- **Equipo de meseros**: la lista de nombres a los que se asignan las mesas.
- **Catálogo y mesas**: categorías (crear, renombrar, ordenar, ocultar), productos (crear, editar nombre, categoría, estación y disponibilidad, y guardar varios precios juntos) y mesas (crear con zona opcional, desactivar o reactivar; no con un pedido activo).
- **Configuración**: IVA, servicio y si los precios los incluyen; estaciones (crear, renombrar, desactivar) y asignación de productos a estaciones. Para desactivar una estación hay que reasignar sus productos y terminar sus pendientes.
- **Fichas de producto**: se editan desde el botón ⓘ del menú. Las iniciales son ejemplos ficticios, identificados como tales.

Cada formulario de administración comprueba que nadie más haya cambiado la configuración entretanto.

## Instalación en el restaurante

El servidor escucha en `0.0.0.0:3000`. Cada dispositivo de la red local abre `http://IP-DEL-SERVIDOR:3000`; todos usan el mismo servidor y la misma base. Funciona sin Internet, pero no sin conexión al servidor.

Para probar varios roles en una sola computadora, usar navegadores distintos o perfiles separados: las pestañas de un mismo perfil comparten la sesión.

### HTTPS en la red local

Por HTTP, las contraseñas y la sesión viajan sin cifrar por el Wi-Fi. Comandas puede servir HTTPS directamente:

1. Crear un certificado para la dirección del servidor (ejemplo con OpenSSL, incluido en Git para Windows; reemplazar la IP):

   ```sh
   mkdir certs
   openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=comandas" -addext "subjectAltName=IP:192.168.100.70,DNS:localhost" -keyout certs/comandas.key -out certs/comandas.crt
   ```

2. En `.env`: `TLS_CERT_FILE=certs/comandas.crt`, `TLS_KEY_FILE=certs/comandas.key`, `COOKIE_SECURE=true` y, si se usa, `APP_ORIGIN=https://192.168.100.70:3000`.
3. Reiniciar y abrir `https://IP-DEL-SERVIDOR:3000`. Con HTTPS activo el puerto deja de aceptar HTTP.

Un certificado autofirmado cifra la conexión, pero cada navegador mostrará una advertencia hasta instalarlo como de confianza en el dispositivo (o usar una autoridad local como `mkcert`). La carpeta `certs/` no se guarda en Git.

### Acceso desde Internet

Usar un proxy inverso con dominio y HTTPS, `APP_ORIGIN` con el origen público y `COOKIE_SECURE=true`, y permitir eventos del servidor (SSE) sin almacenamiento intermedio. Con un PostgreSQL externo, usar un usuario con permisos mínimos para el servidor y otro para `db:init`.

## Operación

- **Servicio**: ejecutar el servidor bajo un supervisor que lo reinicie. `docker compose --profile app up -d --build` levanta la aplicación en un contenedor que aplica las migraciones al iniciar y se reinicia solo; sin ese perfil, `docker compose up -d db` levanta únicamente PostgreSQL.
- **Salud**: `GET /api/health` responde `{"ok":true}` sin sesión cuando el servidor y PostgreSQL están disponibles, y 503 si la base no responde.
- **Errores**: los fallos internos se registran en la salida del servidor con fecha, método, ruta y traza. El navegador solo recibe un mensaje genérico.
- **Cortes de base**: si PostgreSQL se reinicia, el servidor registra el aviso y continúa.
- **Respaldos**: `npm run db:backup` crea `backups/comandas-FECHA.dump` y conserva los últimos 30. Usa `pg_dump` si está instalado o, si no, el contenedor de Compose. Programarlo a diario (por ejemplo, con el Programador de tareas de Windows) y copiar la carpeta fuera del equipo. Para restaurar en el contenedor:

  ```sh
  docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/ARCHIVO.dump
  ```

- **Datos**: el volumen `postgres_data` conserva la información al reiniciar el contenedor. `docker compose down -v` lo elimina.

## Seguridad y consistencia

- Contraseñas con scrypt; sesiones de 12 horas guardadas en PostgreSQL como hashes, en una cookie HttpOnly y SameSite=Strict. Cerrar sesión en un dispositivo no cierra las demás.
- El límite de ingresos (40 intentos fallidos cada 15 minutos por dirección) no cuenta los ingresos correctos.
- Los permisos se validan en el servidor en cada operación. Se verifica el origen de las peticiones que modifican datos y la política de contenido solo admite recursos propios: fuentes e iconos se sirven desde `vendor/`.
- Cada cambio de un pedido ocurre en una transacción con el pedido bloqueado. Un índice impide dos pedidos activos en la misma mesa.
- Los cambios que reemplazan datos (editar, enviar, cuentas, cobro, cierre) exigen la versión vigente del pedido; si otro usuario lo modificó, se rechazan y el navegador actualiza. Añadir productos, marcar preparado y retirar no lo exigen, de modo que salón y estaciones trabajan a la vez sobre la misma mesa.
- Los cambios llegan a los demás dispositivos por eventos del servidor (PostgreSQL `LISTEN/NOTIFY` y SSE), con una consulta cada 15 segundos como respaldo.

## Desarrollo

```
index.html, scripts.js, styles.css, app.css   Interfaz (sin paso de compilación)
money.js                                      Cálculo de importes, compartido por navegador y servidor
server/index.js                               Arranque, HTTPS opcional y escucha de notificaciones
server/app.js                                 Aplicación Express, cabeceras y archivos estáticos
server/routes/                                Rutas por área: sesión, estado, pedidos, registros, administración
server/shared.js                              Validaciones, permisos y utilidades comunes
server/migrations/                            Migraciones numeradas; server/migrate.js las aplica
server/init.js, server/backup.js              db:init y db:backup
vendor/                                       Fuente e iconos de terceros
docs/                                         Contrato provisional con LSoft y notas de la recuperación del diseño
```

Para un cambio de esquema, añadir `server/migrations/NNN_nombre.sql` con el número siguiente; no modificar las ya aplicadas.

```sh
npm test
```

Las pruebas de integración crean y eliminan su propia base temporal, por lo que `DATABASE_URL` debe apuntar a una instancia de desarrollo con permiso para crear bases, nunca a producción. Cubren roles y privacidad, concurrencia, rondas y retiros, correcciones y anulaciones, descuentos, cuentas y envío al simulador, historial y auditoría, administración, contraseñas y migraciones. `.github/workflows/ci.yml` las ejecuta en cada push y pull request.

## Limitaciones conocidas

- La integración con LSoft es un simulador; la forma fiscal de descuentos y anulaciones debe acordarse con LSoft.
- No hay modo sin conexión al servidor.
- El cobro no se registra ni se verifica: solo las confirmaciones manuales.
- `scripts.js` concentra toda la interfaz en un archivo.
