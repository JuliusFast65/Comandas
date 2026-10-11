# Contrato provisional Comandas → LSoft (v0.1)

Propuesta para revisar con el equipo de ListoSoft. No describe la API existente.
El simulador se ejecuta en el servidor de Comandas y persiste en PostgreSQL.
El navegador llama a la API de Comandas; no hay solicitudes a LSoft.
No genera facturas fiscales, no transmite al SRI y no procesa pagos reales.

## Operaciones propuestas

- `POST /api/comandas/pedidos`: recibir un Pedido por cuenta.
- `GET /api/comandas/pedidos/{idOperacion}`: consultar recepción, factura y pago.
- El cobro y la firma se realizan físicamente en caja, fuera de Comandas. La interfaz no ofrece simular cobros.

El backend real deberá autenticar al restaurante, validar productos/precios/cargos
y devolver sus propios identificadores. `productoReferencia` actualmente contiene el
nombre; debe mapearse a un código de artículo de LSoft antes de una integración real.
Comandas autentica usuarios y valida roles en el servidor. La integración externa
con LSoft y el aislamiento entre restaurantes siguen pendientes.

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
o anulación acordada con LSoft. Se libera la mesa mediante confirmación del mesero
responsable, caja o administrador cuando todas las cuentas estén enviadas y los
productos preparados, después de que los clientes se retiren. Para llevar se
finaliza el pedido. La operación se archiva sin marcarla pagada.

## Persistencia de la demo

Pedidos, clientes por cuenta, tarifas, propinas, JSON enviados, pagos simulados históricos
y operaciones cerradas se conservan en PostgreSQL y se comparten mediante SSE.
Las acciones usan transacciones y control de versión. Cada cuenta utiliza
`COM-{UUID del pedido}-C{número de cuenta}` como identidad estable. Los cierres
mantienen el pedido y sus datos de recepción/pago en el historial.
El adaptador real deberá sustituir el simulador por llamadas autenticadas a LSoft.
