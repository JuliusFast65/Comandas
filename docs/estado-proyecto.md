# Estado y decisiones de Comandas

Actualizado: 7 de octubre de 2026. Referencia funcional: **Roles 1**.

## Contexto y objetivo

Comandas comenzó como un prototipo de pedidos de restaurante. Se retomó para
explorar Codex y probar mejoras concretas. ListoSoft tiene clientes restaurantes
que podrían participar en un piloto; no hay todavía un restaurante piloto confirmado.
La intención es evaluar un flujo operativo y preparar su integración con LSoft.

LSoft es un ERP .NET con SQL, instalado normalmente en el servidor del cliente,
con posibilidad de alojarlo en un servidor de ListoSoft. Cuenta con una API JSON
para recibir Pedidos o facturas. Su contrato real aún no se ha proporcionado.
Se prefiere enviar **Pedidos** y dejar que LSoft genere la factura y la electrónica
del SRI, además de registrar el cobro.

## Repositorio y ejecución

| Elemento | Ubicación o estado |
| --- | --- |
| Repositorio | JuliusFast65/Comandas |
| Ref original | release.v-240801-1pm |
| Rama de desarrollo | codex/comandas-persistencia |
| Rama de publicación | gh-pages |
| Demo | https://juliusfast65.github.io/Comandas/ |
| Implementación | HTML, CSS y JavaScript, sin framework ni compilación |
| Datos | localStorage, por navegador y origen |
| Pruebas | 25 casos existentes en tests/persistence.cjs al documentar esta versión |

El trabajo de este hilo se realizó en un checkout cloud; no modifica el disco D
del usuario. Otro hilo debe inspeccionar el checkout y su rama: no debe asumir
que conoce esta conversación o que ya restauró los cambios más recientes.

## Flujo implementado

1. Usuario entra con un rol de demostración.
2. Mesero abre una mesa libre o pedido para llevar; se asigna su identidad.
3. Añade productos a la cuenta seleccionada; puede poner nombre y notas.
4. Confirma y envía alimentos a Cocina y bebidas a Bar.
5. Estación marca productos preparados; mesero retira unidades o todo lo listo.
6. Pide cuenta, revisa consumo, completa datos y propina opcional, o imprime.
7. Envía cada cuenta directamente desde la precuenta al simulador de LSoft.
8. LSoft · Caja muestra cuentas enviadas, pagos y errores de envío.
9. Administrador simula el cobro; se consulta el estado de todas las cuentas.
10. Se permite cerrar la mesa solo cuando todas están pagadas según el receptor;
    el cierre se conserva y se libera la asignación del mesero.

## Decisiones de producto vigentes

- Categorías visibles y deslizables; tarjetas compactas y buscador global que
  ignora mayúsculas y tildes. Cantidades del borrador por cuenta.
- Una cuenta es una partición del consumo de una mesa. Cambiar el selector no
  mueve productos previos; las rondas posteriores se identifican como adicionales.
- La estación prepara; el mesero retira. Retirar no significa confirmar entrega
  al cliente. Se admiten retiros parciales de unidades de una línea.
- Azul: falta preparar y no hay nada listo. Naranja: hay algo listo para retirar,
  con prioridad sobre azul. Verde: todo lo enviado fue retirado. Cuenta pedida y
  adicionales se indican con texto, sin añadir colores. Libres: aspecto neutro.
- Cocina y Bar ocultan líneas totalmente retiradas. Ver retirados está cerrado
  por defecto y conserva la consulta de pedidos abiertos; se limpia al cerrar.
- Precios de demostración editables. IVA 15% y servicio 10% por defecto,
  configurables; servicio 0 lo desactiva. IVA y servicio usan la misma base.
  El IVA **no** grava el servicio. Propina voluntaria independiente.
- Precios incluyen cargos por defecto; se puede usar precio base más cargos.
  Cambiar el modo conserva los números y cambia su interpretación; requiere
  revisar los precios. Productos ya añadidos conservan su tarifa.
- Los pedidos antiguos sin tarifa reciben precios de demo al activar esa versión.
  Importes redondeados a centavos; el desglose debe conservar el total final.
- Una operación por cuenta tiene identidad estable: reintentar no debe duplicar
  Pedidos. Se bloquean nuevas rondas y edición de datos tras enviar a LSoft.
- El chip identifica al usuario; el badge de mesa identifica al mesero.
  Configuración va en el menú hamburguesa. Login recuerda el último acceso exitoso.

## Usuarios y permisos de demostración

Contraseña común: `1234`. No son cuentas reales de un servidor.

| Usuario | Rol | Pantalla inicial y responsabilidades |
| --- | --- | --- |
| admin | Administrador | Todas las mesas; configuración, reasignación, cobro simulado y cierre |
| mesero1, mesero2 | Mesero | Mis mesas y libres; pedidos propios, retiros, precuentas y envío |
| cocina | Estación Cocina | Preparación en Cocina; no retiro ni configuración |
| bar | Estación Bar | Preparación en Bar; no retiro ni configuración |
| auditor | Auditor / Sistemas | LSoft · Caja, consulta de estados, JSON y cierres; no modificaciones ni cobros |

Administrador puede elegir un mesero manualmente. Al entrar como mesero, la
identidad sustituye ese selector. La lista configurable de nombres aún no crea
usuarios nuevos: los seis accesos de demo están definidos en código.

## Integración actual y límites

`LSoftSimulado` es un receptor local, no una API HTTP. Ver
[contrato provisional](lsoft-contrato.md) y [ejemplo](lsoft-pedido-ejemplo.json).
El contrato usa centavos y USD, nombres como referencias provisionales de producto,
datos del cliente, tarifas por línea, totales, propina y referencia del mesero.

No existe conexión real a SQL, LSoft, SRI o DataFast. No se procesa dinero.
El registro de operaciones cerradas es local, no un sistema de auditoría de producción.
Usuarios y permisos se comprueban en interfaz y funciones, pero no constituyen
autenticación ni autorización de servidor. El acceso recordado incluye contraseña
de demo. Todos los datos, incluidos cliente y propina, se almacenan en este navegador.
No hay sincronización entre tablets ni aislamiento multiempresa.

Las pruebas ejecutadas han sido de DOM con jsdom, sintaxis y solicitudes HTTP
locales. No equivalen a una validación visual en todos los navegadores, impresión
física, pruebas de carga, seguridad o compatibilidad con equipos del restaurante.
El usuario ha probado la demo publicada; Codex no pudo consultar su despliegue
por API ni el sitio público desde el entorno usado en varias etapas.

## Próximas fases acordadas

### Cerrar el nivel actual

- Probar un turno completo cambiando roles y revisar errores en móvil.
- Revisar cancelaciones, correcciones y tratamiento de rondas después del envío
  al ERP; el bloqueo actual es deliberadamente simple.
- Validar impresión en equipos reales y los redondeos con el equipo de LSoft.
- Obtener contrato real, respuesta, consulta de pagos, identificación de artículos,
  autenticación y reglas fiscales del ERP. Definir acceso HTTPS al servidor cliente.
- Antes de un piloto real: backend, almacenamiento compartido, autenticación,
  autorización y registro de operaciones de servidor.

### Menú y destinos configurables — propuesta, no implementada

1. Crear destinos como Cocina, Bar, Parrilla o Cafetería; un destino por producto.
2. Cada sección tendrá un destino predeterminado, modificable por producto.
3. Enviar cada parte del pedido a su destino y conservar el flujo preparar/retirar.

Hoy las secciones son fijas y el destino depende de listas de nombres en código.
La edición actual permite cambiar precios, no crear el menú ni destinos.

### Importación — propuesta, no implementada

1. Pegar texto con secciones, productos y precios.
2. Revisar propuesta, ambigüedades, precios con cargos y destinos.
3. Confirmar añadir o reemplazar; no reemplazar sin revisión.
4. Luego extracción de DOCX/PDF y reconocimiento de imágenes o escaneos con IA.

Empezar sin IA para texto estructurado. Incorporarla cuando resuelva ambigüedades
o reconocimiento de documentos, sin saltarse la revisión humana.

## Abrir otro hilo

Mensaje sugerido:

> Trabajamos en JuliusFast65/Comandas, rama codex/comandas-persistencia.
> Lee AGENTS.md, README.md y docs/estado-proyecto.md antes de cambiar código.
> La demo se publica desde gh-pages. El objetivo de este hilo es [tema].
> Conserva los flujos existentes y comprueba la mejora con pruebas relevantes.

Un tema por hilo facilita el orden. Evitar trabajos simultáneos sobre la misma
rama y archivos sin coordinación. Los documentos son el contexto compartido;
actualizarlos al tomar nuevas decisiones.
