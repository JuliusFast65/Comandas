# Contrato provisional Comandas → LSoft (v0.1)

Propuesta para revisar con el equipo de ListoSoft. No describe la API existente.
La demo utiliza un adaptador local en `scripts.js`; no realiza solicitudes HTTP.
No genera facturas fiscales, no transmite al SRI y no procesa pagos reales.

## Operaciones propuestas

- `POST /api/comandas/pedidos`: recibir un Pedido por cuenta.
- `GET /api/comandas/pedidos/{idOperacion}`: consultar recepción, factura y pago.
- El cobro ocurre en LSoft. **Simular cobro en LSoft** es solo una acción de prueba.

El backend real deberá autenticar al restaurante, validar productos/precios/cargos
y devolver sus propios identificadores. `productoReferencia` actualmente contiene el
nombre; debe mapearse a un código de artículo de LSoft antes de una integración real.
Tampoco se ha implementado conectividad HTTPS, CORS, autenticación ni aislamiento entre restaurantes.

## Importes e identidad

Todos los importes viajan como **centavos enteros**, moneda USD. IVA y servicio
se calculan sobre la misma base. La propina no forma parte de esas bases.
Cada cuenta tiene un `idOperacion` aleatorio ligado al servicio de esa mesa.
Reenviar el mismo identificador y JSON devuelve el mismo Pedido. Reutilizarlo
con contenido diferente debe producir un conflicto, no una segunda factura.
El identificador debe persistir antes de enviar; si la respuesta se pierde, se
consulta o reintenta con el mismo identificador.

Estados de respuesta: `pendiente_pago`, `pagado`; campos `pedidoId`, `facturaId`
y, al pagar, `medioPago`, `pagadoEn`. `sri: no_aplica_simulacion` distingue
explícitamente esta demo de un resultado fiscal real. El contrato final necesitará
estados separados de recepción, facturación, autorización SRI, pago y anulaciones.

La demo bloquea nuevas rondas y edición de datos después del primer envío.
Modificar pedidos recibidos requerirá una operación explícita de actualización
o anulación acordada con LSoft. Solo se cierra la mesa cuando todas las cuentas
están pagadas según el receptor. Antes de liberarla se archiva la operación local.

## Persistencia de la demo

Pedidos, datos de facturación, simulador y operaciones cerradas se conservan en
localStorage de este navegador. No es una base central ni un registro auditable
de producción. Al usar otro dispositivo no se comparten los datos. Para probar,
utiliza datos ficticios. El adaptador real deberá sustituir el almacenamiento del
simulador por llamadas autenticadas a la API de LSoft.
