# Recuperación de la versión móvil

Referencia visual y funcional: commit `4c0a111` (`orden-movil-1`), encontrado en el historial de todas las ramas. La recuperación anterior utilizó `f28dc77`, que no incluía estas mejoras.

| Función de la versión más reciente              | Adaptación con PostgreSQL                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| Menú superior y chip del usuario                | Sesión del servidor, menú por rol y cierre de sesión                     |
| Categorías en chips y lupa expandible           | Búsqueda en todo el catálogo, ignorando acentos                          |
| Productos compactos con cantidad por cuenta     | Borradores guardados, agrupados por producto, cuenta, nota y tarifa      |
| Resumen móvil / detalle en escritorio           | Revisión en diálogo móvil y panel en escritorio                          |
| Preparación y retiro separados                  | Estación marca preparado; mesero registra cantidades retiradas           |
| Retiro parcial, por área o de todo lo listo     | Validación de cantidades, transacciones y control de versión             |
| Consulta de retirados y colores de mesas        | Contadores obtenidos del estado compartido                               |
| Notas y rondas adicionales                      | Notas por producto y marca de adicional al enviar otra ronda             |
| Mesero responsable, insignias y filtro personal | Equipo persistido y control de pertenencia en la API                     |
| Precios, IVA y servicio incluidos o separados   | Cálculos en centavos y tarifa congelada por producto pedido              |
| Precuenta por cuenta y propina opcional         | Datos y propina persistidos; impresión de precuenta                      |
| Envío, consulta, reintento y pago de LSoft      | Simulador en el servidor, identidad estable y JSON persistido            |
| Cierre pagado e historial                       | Se archiva el pedido; se libera la mesa sin borrar datos                 |
| Administrador, meseros, estaciones y auditor    | Contraseñas y permisos del servidor, sin recuperar el acceso demo `1234` |

Se mantienen las cuentas PostgreSQL `mesero` y `caja` además de los usuarios de la última demo. El administrador puede vincular cada usuario mesero a un integrante del equipo. La inicialización conserva las contraseñas existentes y no elimina pedidos, productos ni clientes.

Las tarifas de los pedidos anteriores sin precios se completan una vez con los valores de demostración originales. El simulador continúa sin conexión real con LSoft ni emisión fiscal.
