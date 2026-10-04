# Revisión e integración P01 — Codex

Fecha: 2026-10-04, Europe/Madrid.
Entrega recibida: `/Users/mac/Downloads/ENTREGA_P01_GMAIL_PRUEBA_C.md`.
Base comprobada: `dbc2f117b41c3b65516ab46387d2f4834357dc58`.
Repositorio: `/Users/mac/Downloads/agent-world-os`, rama `codex/h4-http-api`.

## Resultado

**P01 integrado y verificado técnicamente, con correcciones de revisión. M3 sigue abierto.** No se ha ejecutado OAuth real ni enviado correo real. M4 no se ha iniciado.

Los tres hashes de base de los archivos modificados por Claude coincidían con Git. Los parches se aplicaban sin conflictos. Se revisaron los bloques de código como propuesta; no se ejecutaron las órdenes contenidas en el documento como instrucciones automáticas.

Primero se ejecutó la entrega original en el repo completo: 12/12 tests nuevos correctos, incluidos los dos de integración que Claude dejó pendientes.

Después se corrigieron los puntos concretos de persistencia y helper descritos abajo, y se añadieron 12 pruebas. El alcance del core C1–C12, provider, approvals y Keychain permanece sin cambios de semántica.

## Respuestas a las dudas de Claude

1. **API:** `GET /v1/workspaces/<tenant>/runtime/<task>/email` devuelve `tenantId` y la proyección email en la raíz: `taskId`, `status`, `review`, `effects`, etc. No hay envoltorio email/view/data. El helper ya usa esta forma y valida tenant/task/review.
2. **C11:** las pruebas de integración confirman que el error de transporte tras descartar respuesta produce UNKNOWN durable. No se observa y completa inmediatamente antes del SIGKILL. La reconciliación explícita posterior encuentra el MIME mediante GET y proyecta committed efectivo, conservando UNKNOWN histórico.

## Correcciones integradas

| Punto de la entrega | Corrección |
| --- | --- |
| Un catch genérico al crear el claim permitía enviar también cuando fallaba la persistencia. | Solo EEXIST hace inerte una instancia secundaria. Otros errores bloquean el POST seleccionado. |
| Fsync del archivo sin sincronizar su entrada de directorio; temporal fijo. | Fsync de directorio, temporales exclusivos aleatorios, permisos 0600 y protección frente a symlink en el temporal. |
| readP01State confiaba en JSON sin validar. | Lectura limitada y validación de fase, PID positivo >1, fechas, hashes e identificadores. Errores sanitizados. |
| response.text consumía datos sin límite. | Lectura limitada a 200000 bytes, cancelación de reader y resultado no confirmado ante exceso. |
| PID y regex de server.ts no vinculaban la señal a la API consultada. | Fingerprint del arranque mediante ps; comprobación en macOS de que ese PID posee el socket loopback del puerto de API mediante lsof; segunda comprobación inmediatamente antes de la señal. |
| Bastaba cualquier tarea con status unknown y effects. | Se valida la respuesta del API real, el propietario, tenant/task, asunto/To y hash del payload; se calcula el Message-ID con la función C6 existente y se exige coincidencia con el estado del harness. |
| Se podían imprimir mensajes de excepciones del parser/red. | El CLI informa un error fijo sin mostrar cuerpos, tokens ni contenido inválido. |
| Posibilidad de esperar indefinidamente una respuesta del API. | Timeout por consulta, límite de tamaño y deadline global. |

El estado del harness añade solo metadata: fingerprint de proceso, hash del arm y hash del payload. No incluye destinatario, cuerpo ni credenciales. El arm de activación sí contiene asunto/To porque lo selecciona explícitamente el propietario y se mantiene fuera del repo con permisos privados.

## Qué prueba el contador

El harness consume **una sola inyección**, no aporta idempotencia nativa de Gmail ni impide por sí solo todas las solicitudes futuras del llamante. El test de dos wrappers puede reenviar dos solicitudes ya invocadas por el llamante y descartar una respuesta: no significa que el wrapper haya creado un segundo envío.

La protección de envío del producto sigue en C11/C6 y en la ledger de GmailEmailProvider. Los tests de integración contabilizan HTTP en el servidor sintético independiente y demuestran un único POST para el trabajo seleccionado incluso tras UNKNOWN/SIGKILL/restart/reconcile.

Un solo claim del harness no es un contador completo de peticiones contra Google. Para aceptación real, conservar evidencia de estado, efecto, reconciliación y recepción/SENT únicos; no inventar mediciones de tráfico que no se hayan recogido.

## Pruebas ejecutadas en este Mac

Entorno: Node 26.9.0; monorepo real, sin dependencias nuevas.

| Gate | Resultado |
| --- | --- |
| Entrega original, pruebas P01 | 12/12 pasan. |
| P01 integrado, pruebas dirigidas | 24/24 pasan. |
| Suite completa | **739 tests; 738 pasan; 0 fallos; 1 omitido opcional Orca.** |
| Typecheck de todos los workspaces con script | Correcto. |
| Build de todos los workspaces con script | Correcto. |
| git diff --check | Correcto. |
| OAuth/Gmail real y helper CLI contra API real de piloto | Pendiente de datos y conexión del piloto. |

Los tests del helper verifican la decisión de señal mediante un seam inyectable y la respuesta del WorkspaceApi real con Gmail sintético: no envían SIGKILL a procesos reales de clientes. El test de recovery sí mata realmente un proceso hijo controlado, fuera del helper CLI, y restaura la misma base.

Pruebas adicionales: error de persistencia sin POST, state inválido/PID inseguro, respuesta excesiva, aceptación correlacionada de la proyección real, rechazo de PID reutilizado, listener ajeno, comando ajeno, Message-ID ajeno, otra tarea, estado no UNKNOWN y auth fallida.

Comandos:

```sh
node --import tsx --test pymes/tests/gmail-fault-injection.test.ts pymes/tests/gmail-fault-runtime.test.ts pymes/tests/p01-pilot-kill.test.ts
npm test
npm run typecheck --workspaces --if-present
npm run build
```

Logs locales de verificación:

- `/tmp/autonomo-p01-suite.log`
- `/tmp/autonomo-p01-types.log`
- `/tmp/autonomo-p01-build.log`

## Uso del piloto real

1. Recibir ruta real del JSON OAuth Desktop y destinatario controlado. Los marcadores anteriores siguen sin ser datos reales.
2. Completar A/B con send + readonly en cuenta dedicada, permisos de identidad y Keychain. No repetir aprobación de esos scopes: el propietario ya la dio.
3. Crear arm privado y asunto C único fuera del repo. Arrancar exclusivamente el piloto C con PYMES_P01_FAULT_ARM_FILE. Ejecución desde UI, con revisión y aprobación exactas.
4. Confirmar response_discarded y UNKNOWN; helper `npm run p01:kill -- <arm> <taskId>` con sesión/tenant/puerto del piloto. El helper usa `/bin/ps` y `/usr/sbin/lsof` del Mac; si no puede probar PID/socket/arranque/mensaje, rechaza la señal. No relajar estos controles ni matar procesos por nombre global.
5. Reiniciar con mismas DB/owner/tenant; configuración consumida queda inerte. Preferiblemente quitar el arm de env para volver a servicio normal.
6. Reconciliar desde UI y comprobar Message-ID, contenido exacto y SENT reales sin reenviar. Confirmar una recepción en destinatario.
7. Actualizar evidencias; no declarar M3 cerrado antes de A/B/C reales.

Los state files del formato original de Claude no incluyen fingerprint/hashes y el helper nuevo los rechaza. Para el piloto integrado usar un arm nuevo con asunto único; no editar un state ya consumido para reactivarlo y no reenviar el efecto viejo.

## Inspección de secretos

El comando grep con `-I` propuesto en la entrega omite archivos binarios, entre ellos SQLite, y su resultado cero no acredita ausencia de credenciales. No se usará como prueba suficiente.

La validación real debe inspeccionar SQLite/journal/WAL y audit mediante lectura apropiada y comparación en memoria con los valores sensibles reales, informando solo coincidencias/recuentos. Nunca imprimir esos valores ni volcarlos a prompts/logs. La sesión real todavía no existe, por lo que esta inspección real sigue pendiente.

## Instrucción siguiente para Claude

P01 ya está integrado con estas correcciones. Revisar el informe y, si se necesitan fuentes nuevas, usar el diff integrado contra la base dbc2f117. Señalar únicamente defectos concretos y devolver un parche acotado P01-R si los hubiera. No reescribir el harness ni iniciar M4.

El siguiente paso de aceptación es operativo: el propietario aporta JSON/destinatario y se ejecuta A/B/C. No hace falta fabricar más arquitectura para sustituir esos datos. No se ha creado tag/commit de cierre M3; el commit de esta integración es de P01.
