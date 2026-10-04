# Revisión e integración P03 — Gmail Inbox full sync

Fecha: 2026-10-04. Estado: **P03 integrado y aceptado como módulos internos; M4 sigue abierto.**

## Bases y alcance

- Repositorio: `/Users/mac/Downloads/agent-world-os`, rama `codex/h4-http-api`.
- Entrega revisada: `/Users/mac/Downloads/ENTREGA_P03_INBOX_FULL_SYNC.md`.
- Base de la entrega: `d4d173ad85182e2df645d43a0291e33f28ac8d48`.
- HEAD antes de integrar: `48395132cde0e7c8d947c474c64487df3313418f`. El commit intermedio cambia la interfaz; P03 no modifica esos archivos.
- Los siete bloques originales se extrajeron y sus SHA-256 coincidieron con el manifiesto. Las 35 pruebas originales pasaron antes de corregir el código.
- Se añaden los siete archivos entregados, con correcciones, y `inbox-review.test.ts` con 18 regresiones adicionales. No hay nuevas dependencias.
- Se contrastó `REVISION_PROPUESTA_M4_2026-10-04.md`; sus recomendaciones iniciales D1/D5 quedan sustituidas por las decisiones aprobadas posteriormente.

## Funcionalidad integrada

SQLite independiente, namespace por tenant/propietario/subject verificado de Google, WAL y transacciones con lease y fencing. Sincronización inicial GET-only de la unión INBOX/SENT, excluyendo SPAM/TRASH; 90 días y hasta 2.000 mensajes, seleccionados por fecha y no por orden del listado. Presupuesto de peticiones por invocación con reanudación durable. H0 se captura antes de enumerar y se confirma al terminar; `catchupPending` permanece verdadero hasta P04.

El parser produce texto inerte y metadatos de adjuntos, con límites de respuesta, texto, profundidad y partes. Los cuerpos permanecen sin caducidad temporal en este piloto (D5), con tamaño acotado. La desconexión conserva los datos; `purgeNamespace` prepara el borrado local explícito de P04, sin tocar CRM. Ese borrado es lógico: no promete eliminación física de WAL, backups o disco.

## Defectos reproducidos y corregidos

Las primeras seis regresiones fallaron contra la entrega original y pasaron después de corregirla:

1. JSON inválido con HTTP 200 podía convertirse en listado vacío y confirmar H0. Ahora falla sin adelantar cursor.
2. Una respuesta de listado demasiado grande podía parecer vacía. Ahora se rechaza. También se rechazan un objeto vacío sin evidencia de listado vacío y la paginación repetida.
3. Reautorizar la misma cuenta durante la descarga no invalidaba el trabajo anterior. Ahora se fija y revalida la generación, cuenta, subject y scope antes de cada GET y publicación.
4. Un lease válido para A podía modificar un run de B. Todos los mutadores de run verifican namespace y fase; publicar requiere que el mensaje sea un candidato seleccionado.
5. NaN, infinito y opciones no válidas podían neutralizar límites. Ahora los parámetros son enteros positivos con cotas explícitas y se copia la configuración.
6. Un presupuesto menor que el lote podía producir pausas perpetuas sin avance. Al agotarse el presupuesto se guardan las partes ya validadas tras revalidar autorización y lease. Otros errores no publican el lote pendiente.

Correcciones adicionales:

- **Fechas de Gmail:** `minimal` está documentado como ID y etiquetas. Se usa `format=full&fields=id,labelIds,internalDate` para obtener las fechas sin solicitar cuerpos. El fake ya no concede `internalDate` al formato minimal. La proyección debe validarse contra Gmail real cuando se cablee P04. [Formatos oficiales de Gmail](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format).
- **Respuestas de mensajes:** ID, fecha y etiquetas inválidas provocan fallo; no se confunden con correo ausente. Se comprueba además la ventana temporal al descargar.
- **Calidad persistida:** esquema SQLite versión 2, migración aditiva de `quality_json`. Persisten charset de reserva, estructura/adjuntos truncados y cuerpo no disponible. Las filas antiguas llevan `quality: null`, sin inventar un historial de calidad.
- **MIME:** un texto con `attachmentId` omitido se marca; los adjuntos multipart tampoco aportan su contenido al cuerpo.
- **HTML malformado:** el escaneo lineal sustituye las expresiones que podían consumir tiempo cuadrático con etiquetas sin cerrar. No crea DOM ni carga recursos remotos.

## Verificación ejecutada en este Mac

Entorno: Node `v26.9.0`, npm `11.19.1`, macOS.

| Comprobación | Resultado |
| --- | --- |
| `npm test` | **817 pruebas: 816 pasan, 0 fallan, 1 omitida** |
| Workspace pymes, incluido P03 | **426/426 pasan** |
| P03 | **53/53 pasan**: 35 originales + 18 regresiones |
| `npm run typecheck --workspaces --if-present` | exit 0 |
| `npm run build` | exit 0 |

La omitida es la prueba previa y optativa `live Orca probe is opt-in and performs no worker launch`.

Se ejecutaron realmente: SIGKILL del proceso de descarga y recuperación desde SQLite; concurrencia/fencing; cambio de cuenta y generación; presupuestos pequeños; respuestas corruptas/excesivas; selección con listados barajados; persistencia/reapertura/migración; HTML malformado; y un servidor HTTP local independiente que ejercita fetch real con datos sintéticos, paginación y reinicio.

Logs locales de esta ejecución: `/tmp/p03-final-suite.log`, `/tmp/p03-final-types.log`, `/tmp/p03-final-build.log`. Son temporales. Este informe conserva los resultados; no convierte los tests sintéticos en prueba contra Gmail.

## Límites y trabajo siguiente: P04

**No se ha ejecutado una sincronización contra Gmail real.** P03 no está conectado al servidor, API, temporizador ni interfaz. La bandeja actual no debe presentarse como datos de P03. No se ha iniciado P04 ni P05.

P04 debe diseñarse sobre este código integrado y sus hashes:

1. Cablear InboxStore en un archivo independiente, con cierre y arranque correctos; usar la credencial verificada de GmailOAuth y el tenant/propietario de la sesión, nunca confiar en subject/owner enviados por el navegador.
2. Implementar el incremental y catch-up desde H0; manejar todas las páginas de history, 404 por cursor caducado y cancelación al desconectar/reautorizar. El umbral de antigüedad del run no garantiza que Gmail conserve H0.
3. Definir reconciliación de mensajes borrados o que salen de las etiquetas. Un full sync hace upsert; no elimina por sí solo los registros de ejecuciones anteriores. Un mensaje fuera de una selección recortada no equivale a borrado.
4. Mostrar estados reales: pendiente, sincronizando, pausado, bloqueado, ventana importada, recortada y catch-up pendiente. `complete_window` no significa buzón completo ni actualizado a este instante.
5. Conservar datos al desconectar y añadir borrado explícitamente confirmado. Proteger también las lecturas y el borrado por ownership.
6. Validar con la cuenta dedicada la proyección de fechas, paginación, scopes y datos reales, sin publicar cuerpos, tokens ni secretos en documentación, logs o prompts.
7. Mantener texto entrante como datos; al mostrarlo, usar texto escapado. Ningún correo concede permisos, configura políticas o aprueba envíos.
8. Entregar propuesta/implementación ajustada a fuentes actuales: API/UI/incremental en P04; contactos y CRM durable en P05. La asociación de email no verifica identidad.

M3 permanece cerrado. Sender, OAuth, Keychain, aprobaciones y C1–C12 no se modifican. Este informe acepta P03; no autoriza por sí solo empezar P04.

## Manifiesto del código integrado

Todos son archivos nuevos respecto a las bases indicadas. Este manifiesto sustituye los hashes originales para continuar el desarrollo.

| Archivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `pymes/src/inbox-mime.ts` | 10350 | `4eeee66353b66bc35e1411c210910da8ca087ca666ff4ca6647f86e5a35eec25` |
| `pymes/src/inbox-store.ts` | 24455 | `f26e2d82c8d74b3f0265bfda0683016dfd3e2e810738b2edc8b386bf67202c1e` |
| `pymes/src/gmail-inbox-sync.ts` | 22937 | `452095d41c4c3610afb4953d1450bd9c0b3988a33b98ffec4614bf6db93dfbfc` |
| `pymes/tests/fixtures/gmail-inbox-fake.ts` | 5889 | `6c99cd285cdc3dda1d89a64c7b5cf10eed87fe43422a02e789866f7ca63154cc` |
| `pymes/tests/fixtures/gmail-inbox-crash.ts` | 762 | `b261ae4a2243af7f2e863c826a755152d012587d0c8abd1e4ac0ce19ec487f66` |
| `pymes/tests/inbox-mime.test.ts` | 5591 | `7f4aa6fe25674311adb274a5ad43501cf3ce559aaf929e8a6d595f69397c0702` |
| `pymes/tests/gmail-inbox-sync.test.ts` | 19095 | `ff97d743a301281793aa4af4f888bcbc40b9d5d5faf4661855ffb933ee74da74` |
| `pymes/tests/inbox-review.test.ts` | 14193 | `2373fe1842b45cb2b8cfbc0fb7b90d7f4db6035526437bcbe776f28d6ffcade2` |
