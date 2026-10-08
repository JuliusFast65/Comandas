# Prueba de un turno de demostración

Usar datos ficticios y el **mismo navegador** para todos los roles. Dispositivos
distintos no comparten pedidos. Cerrar sesión no borra el consumo.

## Preparación

Entrar como admin / 1234. Desde el menú, revisar precios, IVA 15% y servicio 10%.
Para comprobar un cálculo sencillo, fijar Pizza en $12,50 con cargos incluidos.
La base debe ser $10,00, IVA $1,50 y servicio $1,00.
Elegir una mesa libre. No borrar datos existentes para iniciar una prueba.

## Pedido y cuentas

1. Entrar como mesero1. Abrir la mesa: debe asignarse a Mesero 1.
2. Añadir una Pizza a Cuenta 1 y una bebida a Cuenta 2; nombrar las cuentas.
3. Buscar "cafe": debe encontrar Café desde cualquier categoría.
4. Confirmar y enviar. La mesa debe aparecer azul.
5. Recargar y volver a entrar: recuperar mesa, consumo, cuentas y responsable.
6. Entrar como mesero2: no debe poder modificar la mesa de Mesero 1.

## Preparación y retiro

1. Entrar como cocina: ver Cocina, marcar Pizza preparada, sin poder retirar.
2. Entrar como bar: preparar la bebida; no debe modificar Cocina.
3. Entrar como mesero1: mesa naranja, retirar solo lo listo.
4. Lo completamente retirado desaparece de la estación y queda en Ver retirados.
5. Cuando todo se retire, mesa verde. Probar varias unidades y retiro parcial.
6. Antes de enviar al ERP, añadir otra ronda: debe indicar adicionales y recuperar
   azul/naranja según preparación. Los importes deben incluir ambas rondas.

## Precuenta y simulador LSoft

1. Pedir Cuenta. Mostrar únicamente el consumo de la cuenta actual, con desglose.
2. Completar datos ficticios; propina vacía debe equivaler a cero. Probar importe
   positivo y comprobar el total. Rechazar negativo o más de dos decimales.
3. Imprimir o guardar PDF si el dispositivo lo admite: solo la precuenta, sin menú.
   También probar campos vacíos para completar en papel.
4. Enviar cada cuenta desde la precuenta. Tras éxito, avanzar a la siguiente.
5. LSoft · Caja debe listar cada cuenta enviada como pendiente; la mesa sigue abierta.
6. Recargar: conservar datos y estado. Ver JSON y reintentar sin duplicar Pedido.
7. Entrar como auditor: consultar JSON y cierres, sin modificar ni simular cobro.
8. Entrar como admin: simular pago de una sola cuenta. Aún no permitir cierre.
9. Simular pago del resto y cerrar: liberar mesa y mesero, conservar operación
   cerrada, limpiar vistas activas e historial de retiros de esa orden.

## Qué registrar

Anotar usuario, pantalla, acción, resultado esperado/observado y etiqueta de versión.
Para un fallo de publicación, revisar GitHub Actions y la etiqueta visible antes
de atribuirlo a la aplicación. No borrar localStorage para actualizar estilos.

Esta prueba verifica el prototipo y el simulador. La aceptación de producción
requiere otro conjunto de pruebas sobre backend, varios dispositivos y API real.
