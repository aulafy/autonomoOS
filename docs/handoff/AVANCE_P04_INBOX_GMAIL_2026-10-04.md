# Autónomo OS — P04a integrado y P04b implementado

Fecha: 2026-10-04. Desarrollo continuado por Codex en el repositorio real.

## Estado y ubicación

- Repositorio: `/Users/mac/Downloads/agent-world-os`.
- Rama: `codex/h4-http-api`.
- Base exacta de esta integración: `ae06df5e5f69c606ec3d2baf0d143803e93c2d53`.
- Entrega original, conservada: `/Users/mac/Downloads/ENTREGA_P04A_INBOX_INCREMENTAL_API.md`.
- Interfaz local: `http://127.0.0.1:5177/?workspaceApi=http%3A%2F%2F127.0.0.1%3A8907&tenant=m3-gmail-pilot#gmail-inbox`.
- API del piloto: `http://127.0.0.1:8907`.
- M3 permanece cerrado con sus evidencias anteriores. En esta sesión no se han enviado correos ni reintentado sus efectos.
- P03 + P04a + P04b están implementados, integrados y probados como se detalla abajo. M4 completo sigue abierto: falta P05, CRM local, y ampliar la aceptación real del inbox.

El contenido de una entrega sirve para revisar e integrar código; sus afirmaciones de pruebas no sustituyen las pruebas ejecutadas en este checkout. Los hashes de los 14 archivos de P04a se verificaron antes de aplicar cuatro parches y añadir diez archivos. La integración inicial pasó las 453 pruebas de PYMES con el kernel real, sin el stub usado por Claude.

## Qué puede hacerse ahora

La sección propia **Correo Gmail** ofrece:

- Importación real de Recibidos y Enviados, conservada en SQLite local separado del journal del runtime.
- Lista y detalle en texto plano, búsqueda por remitente, asunto y vista previa, filtros Recibidos/Enviados/Archivados y paginación.
- Cuenta seleccionada y estado de sincronización, fecha de última actualización y avisos de selección recortada o catch-up pendiente.
- Sincronización manual con respuesta HTTP 202 y consulta del progreso; consulta automática cada cinco minutos, con espera creciente ante errores.
- Datos conservados al desconectar Gmail. El contenido de una cuenta guardada se oculta mientras otra cuenta está conectada.
- Borrado local explícito: confirmación aleatoria ligada a cuenta, propietario y revisión, caducidad, un solo uso y frase BORRAR. Tras el borrado, la consulta automática queda pausada de forma durable hasta una sincronización manual.
- Presentación adaptada a escritorio y pantallas estrechas, con menú lateral y estados vacíos.

La bandeja de ejemplo, los casos del workspace y Correo Gmail tienen orígenes distintos. La pantalla Gmail no ofrece enviar, responder, descargar adjuntos ni modificar etiquetas. La lectura no crea todavía contactos, leads, propuestas o seguimientos.

## Integración P04a

### Store y sincronización

`pymes/src/inbox-store.ts` incorpora la migración v3, referencias opacas de cuenta, revisión de contenido, progreso incremental durable, cursores de listado y confirmación de purga.

`pymes/src/gmail-inbox-incremental.ts` recorre el historial y consulta el estado actual de cada mensaje afectado. Guarda páginas y aplicaciones antes de avanzar el cursor final. Los presupuestos pequeños progresan y las ejecuciones interrumpidas retoman su avance.

Un historyId caducado provoca nueva importación completa más reconciliación de todos los ids locales anteriores. Quedar fuera del recorte inicial de 2.000 no equivale a eliminación. Spam/papelera y mensajes eliminados vacían contenido, cabeceras y adjuntos locales; un mensaje que vuelve a la selección recupera su contenido.

`pymes/src/inbox-service.ts` coordina ejecución única, temporizador, backoff, cancelación y suspensión durante cambios de autorización o borrado. `server.ts` espera a cancelar el inbox antes de cerrar sus recursos.

### API

Ruta base: `/v1/workspaces/<tenant>/gmail-inbox`.

| Método | Sufijo | Función |
| --- | --- | --- |
| GET | vacío | Estado y cuentas propias |
| GET | `/messages` | Lista; scope, q, limit, cursor y accountRef |
| GET | `/messages/<gmailId>` | Detalle y contexto |
| POST | `/sync` | Sincronización; `{background:true}` devuelve 202 |
| POST | `/purge/prepare` | Prepara confirmación para la cuenta propia |
| POST | `/purge` | Purga confirmada, con phrase BORRAR |

Solo el propietario configurado del piloto puede usarla. Tenant y propietario proceden de la sesión; una referencia suministrada por el cliente nunca permite seleccionar datos de otro propietario. Las respuestas llevan un contexto opaco para descartar resultados tardíos.

## Correcciones adicionales de Codex

Se reprodujeron estos cinco defectos con pruebas que fallaban antes de corregirlos:

1. Dos sincronizaciones podían iniciarse mientras esperaban la credencial. Ahora la ejecución única se reserva antes de ese await.
2. Cerrar durante la consulta inicial de credenciales podía permitir un GET posterior al cierre. Ahora se comprueba la cancelación antes de consultar Gmail.
3. Un ciclo de tokens de historial A → B → A no se detectaba. Ahora los tokens vistos se guardan y verifican entre checkpoints.
4. Un cambio de cuenta durante la resolución del contexto podía devolver contenido de la cuenta anterior. La API comprueba de nuevo el contexto y la sesión antes de publicar.
5. El adaptador HTTP descartaba el query string: filtros y búsqueda funcionaban en tests directos de la API pero no en el navegador. Ahora lo conserva; la prueba pasa por el adaptador HTTP real.

Además:

- La falta de gmail.readonly se muestra como autorización necesaria, incluso antes de la primera importación; no se inicia ninguna petición Gmail.
- La sincronización manual de la UI usa 202 para no esperar al final de un trabajo dentro del timeout del cliente.
- Conectar, desconectar y purgar suspenden nuevas ejecuciones mientras cancelan y esperan a la actual.
- El cierre del servidor espera la cancelación antes de cerrar SQLite/Keychain/runtime.

No se modificaron la semántica C1–C12, el provider de envío Gmail, los contratos de aprobación ni la implementación de Keychain. El harness P01 queda disponible para sus pruebas aisladas y estuvo desactivado en esta sesión.

## P04b y archivos principales

- `pymes/src/gmail-inbox-view.ts`: validación acotada de respuestas y funciones de selección/contexto.
- `pymes/src/gmail-inbox-screen.ts`: pantalla, búsquedas, detalle, actualización y diálogo de borrado.
- `pymes/src/gmail-inbox-screen.css`: diseño y adaptación responsive.
- `pymes/src/workspace-client.ts`: llamadas a las nuevas rutas con los contratos reales.
- `pymes/index.html`, `main.ts`, `navigation.ts`: sección y conexión del cliente con inicio/cierre de sesión.
- `pymes/src/gmail-settings.ts`: explicación de permisos y notificación de cambios de conexión.
- `pymes/tests/inbox-p04-review.test.ts`: cinco regresiones de integración.
- `pymes/tests/gmail-inbox-view.test.ts`: ocho pruebas de cliente → HTTP → API → store, contexto tardío, límites, purga, sincronización asíncrona y permiso de lectura.

Todo texto procedente de Gmail se inserta como texto, sin ejecutar HTML ni cargar imágenes remotas del correo. Adjuntos: solo metadatos. No hay acciones sobre una selección invisible. Un cambio de filtro, cuenta, sesión o revisión invalida respuestas tardías y limpia el detalle.

## Pruebas ejecutadas en el repositorio

| Comprobación | Resultado |
| --- | --- |
| `npm test` | 857 descubiertas: 856 pasan, 0 fallan, 1 omitida |
| Pruebas PYMES dentro de la suite | 466/466 pasan |
| `npm run typecheck --workspaces --if-present` | Correcto |
| `npm run build` | Correcto en todos los workspaces que ofrecen build |
| `git diff --check` | Correcto |

La prueba omitida es el probe real de Orca, activable explícitamente; no es una prueba Gmail. La suite incluye los tests de P03/P04a con SIGKILL, lease entre procesos y migración v2. Las mutaciones relatadas por Claude no se han repetido en esta sesión; el resultado anterior corresponde a nuestros tests ejecutados, sin atribuirnos aquellos experimentos.

### Gmail real, cuenta dedicada del piloto

Se reutilizó la autorización existente en Keychain:

- Importación inicial y catch-up: **27 correos** guardados; estado up_to_date, sin error, sin recorte y sin catch-up pendiente.
- Recibidos: 23. Enviados: 4, incluidos los correos sintéticos de M3.
- Sincronización manual desde la pantalla: vuelve a consultar el historial, termina y conserva 27 sin duplicados.
- Reinicio normal del servicio: autorización y datos conservados, nueva consulta correcta sin reconectar Gmail.
- Filtro Enviados muestra los cuatro registros correctos; búsqueda sin coincidencias limpia lista y detalle.
- Diálogo de borrado: se verificó la preparación y que BORRAR habilita el botón; se **canceló**. No se purgó el inbox real.
- Pantalla estrecha: menú abre/cierra y no hay desbordamiento horizontal del documento. Se restauró la vista normal al terminar.
- Consola del navegador: sin errores ni warnings registrados en la revisión final.

Capturas en Downloads:

- `AUTONOMO_OS_CORREO_GMAIL_2026-10-04.png`: escritorio, solo contenido sintético del correo C de M3.
- `AUTONOMO_OS_GMAIL_MOVIL_2026-10-04.png`: vista estrecha, mismos correos de prueba.

No se guardan cuerpos, credenciales ni tokens en este documento. La nueva base `runtime.db.gmail-inbox.db` y sus WAL/SHM tienen modo 0600, en el directorio privado del piloto (0700). La inspección binaria de las bases y WAL/SHM no encontró patrones `ya29.`, `GOCSPX`, `1//0` ni el bearer actual del workspace. Esto es una comprobación acotada, no una prueba absoluta de ausencia de cualquier secreto. Las bases anteriores siguen dentro del directorio privado del piloto y esta entrega no cambia sus permisos.

## Decisiones de producto vigentes

- D1: ventana inicial de 90 días; selección de los 2.000 más recientes, sin presuponer el orden del listado Gmail.
- D2: unión Recibidos/Enviados; sin spam ni papelera.
- D3: conservar caché al desconectar; borrado explícito por el usuario.
- D4 para P05: vinculación automática solo por email normalizado exacto y único, registrada y reversible; remitente nuevo, ambigüedad o Reply-To diferente requieren revisión. Coincidencia de email no demuestra identidad verificada.
- D5: sin límite temporal de cuerpos en el piloto, con límites de tamaño; política configurable pendiente antes de comercialización.
- D6: importación CSV fuera de M4.
- D7: archivados conservados, ocultos por defecto; spam/papelera vacían contenido local.
- D8: cinco minutos más botón manual y backoff.
- D9: confirmación BORRAR, ligada a una instantánea/revisión.

## Qué falta y orden de continuación

### Completar aceptación real de Inbox

Cubierto sintéticamente pero aún no acreditado contra cambios reales de Gmail:

1. Un correo nuevo después de H0 entra por incremental, sin duplicarse al repetir.
2. Archivar, mover a spam/papelera y restaurar actualiza el estado local previsto.
3. Historial caducado con ids locales fuera del recorte conserva o vacía cada registro según el estado actual.
4. Desconexión/cambio de cuenta durante una sincronización y purga real con pausa posterior.

Estas pruebas requieren operaciones deliberadas en Gmail o borrado del caché de prueba; no se ejecutaron como parte de esta revisión de lectura. La purga, sus carreras y la pausa tras reinicio sí tienen pruebas con datos sintéticos descartables.

### P05 — CRM local real

Siguiente entrega de desarrollo, ya dentro de nuestro repositorio:

1. Ajustar las entidades al journal durable existente: Contact, Identity, Lead, Interaction y FollowUp, con namespace por tenant/owner, procedencia, comando idempotente e historial.
2. Resolver remitentes con las reglas D4; crear/vincular manualmente desde un correo y llevar los casos ambiguos a revisión. Sin normalizar puntos o +alias de Gmail.
3. Crear leads para coche, vida, hogar y responsabilidad civil de autónomos, interacciones y seguimientos con fecha/estado.
4. Conectar Clientes y Tareas a datos reales; distinguir cualquier fixture restante.
5. Integrar los pasos locales CRM del workflow sin cambiar C11. Envío COMMITTED → interacción saliente ligada al effectId; UNKNOWN → interacción incierta, nunca confirmada como enviada.
6. Probar replay, aislamiento, idempotencia, conflicto de versiones y reversión de vínculos. Incluir CRM en la estrategia de backup existente, sin secretos.

Después: clasificación/resumen con IA y workflow integrado (M4.3/M4.4), respuestas en hilo, Google Calendar y siguientes canales. P04 no convierte esos módulos en conectores reales.

### Antes de vender

Siguen pendientes la política de retención y borrado/backup, instalación y actualización reproducibles en Mac, aceptación de los conectores reales, verificación OAuth aplicable a distribución y validación de recursos en los equipos objetivo. Esta entrega no instala modelos ni cambia la configuración LLM del Mac; no acredita todavía el producto completo para comercialización.
