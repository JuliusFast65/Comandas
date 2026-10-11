# Instrucciones de trabajo

## Cierre de cada requerimiento

- Al completar cada nuevo requerimiento que cambie archivos, revisar el diff y ejecutar las comprobaciones pertinentes; en Windows usar `npm.cmd`.
- Crear un commit descriptivo y hacer push a la rama de trabajo antes de la respuesta final. La petición del usuario autoriza este cierre habitual sin pedir otra confirmación.
- Verificar que el commit local coincide con la rama remota y comprobar el estado del árbol de trabajo. Informar el hash del commit, la rama y el resultado de las comprobaciones.
- No incluir secretos ni cambios ajenos al requerimiento. No usar force push ni descartar cambios del usuario.
- Si una comprobación o el push falla, informar el bloqueo y resolverlo cuando sea posible; nunca afirmar que el cierre está completo si falta el push.
- Si el usuario pide solo inspección, indica que no se modifiquen archivos o solicita posponer commit/push, respetar esa instrucción.
