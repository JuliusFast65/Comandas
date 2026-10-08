# Continuar el trabajo en Comandas

Antes de modificar la aplicación, leer `README.md`, `docs/estado-proyecto.md` y,
si afecta al ERP, `docs/lsoft-contrato.md`. Las decisiones propuestas y pendientes
no equivalen a funciones implementadas.

- Código de desarrollo: `codex/comandas-persistencia`. Publicación: `gh-pages`.
  Inspeccionar la rama y `git status` antes de cambiar archivos; preservar cambios
  ajenos. No cambiar de rama ni actualizar desde remoto sobre trabajo sin guardar.
- Cada tarea cloud está aislada. Usar el checkout existente; no crear un worktree
  salvo que el usuario lo pida. Coordinar tareas simultáneas sobre los mismos archivos.
- Aplicación estática: `index.html`, `styles.css`, `scripts.js`. Sin build ni backend.
- Validar cambios funcionales con `node --check scripts.js` y la suite existente
  `tests/persistence.cjs` usando jsdom 26.1.0. Preparación y comandos en README.
  Añadir pruebas cuando verifiquen un comportamiento nuevo o una regresión real.
- Mantener los precios ya asignados a los productos; IVA no grava servicio.
  Importes del contrato LSoft en centavos enteros. No inventar códigos del ERP.
- Los usuarios y permisos son de demostración en el navegador; no presentarlos
  como autenticación de servidor. LSoft, SRI y DataFast siguen sin conexión real.
- Publicar únicamente cuando esté autorizado. Para GitHub Pages, incluir solo
  HTML, CSS y JS; excluir `.vs`, pruebas, datos de clientes, herramientas y documentos.
  No hacer force-push. Preservar cambios remotos de `gh-pages` y usar su commit como
  padre. Una subida de Git no confirma el despliegue; comprobarlo cuando sea posible.
- Al publicar cambios de aplicación, actualizar las versiones de CSS/JS y la
  etiqueta visible de demo en HTML. Conservar nombres de claves de almacenamiento
  o implementar migraciones; no borrar datos del navegador como solución de caché.
- Actualizar la documentación si cambian el flujo, permisos, contrato o limitaciones.
  Reportar qué se comprobó y qué sigue sin probar.
