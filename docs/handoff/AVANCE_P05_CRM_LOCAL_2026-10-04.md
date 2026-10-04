# P05 — CRM local y seguimiento profesional

Fecha: 4 de octubre de 2026. Avance implementado por Codex, continuando P04.

## 1. Repositorio y estado

- Checkout: `/Users/mac/Downloads/agent-world-os`.
- Rama: `codex/h4-http-api`.
- Base de esta entrega: `e0ee7e5a1d6e46616046981183b4ce1d82e105e3`.
- P05 está implementado y probado dentro del repositorio real. El kernel C1–C12 conserva su semántica.
- M3 conserva su aceptación previa contra Gmail real. Esta entrega no repite envíos A/B/C.
- P03/P04 conservan los límites de aceptación real de su documento de avance.
- M4 completo sigue abierto: falta integrar y validar la clasificación/resumen con IA y el workflow desde correo entrante.

## 2. Qué se puede hacer en la interfaz

### Clientes

- Crear y editar una ficha: nombre, teléfono, notas y relación prospecto/cliente.
- Archivar y recuperar contactos; añadir y retirar direcciones de email.
- Buscar por nombre, teléfono o dirección activa de email.
- Crear oportunidades de coche, vida, hogar, responsabilidad civil profesional u otro ramo.
- Cambiar su estado: nueva, contactado, propuesta, ganada o perdida.
- Registrar notas para preparar llamadas y conservar su historial.
- Programar seguimientos asociados opcionalmente a una oportunidad.
- Consultar métricas de contactos activos, oportunidades abiertas, pendientes y vencidos.

### Tareas

- Consultar los seguimientos pendientes, hechos, cancelados o todos.
- Marcar un seguimiento como hecho o cancelarlo.
- Abrir la ficha de su contacto.
- Se guardan en el servicio local; la pantalla no depende del listado de ejemplo anterior.

### Correo Gmail

- Desde un mensaje visible: «Ver / vincular contacto».
- Coincidencia exacta y única con una dirección de un contacto activo: vínculo automático registrado y reversible al consultar la resolución (POST).
- Remitente nuevo, varias coincidencias, Reply-To diferente o cabeceras no fiables: revisión humana.
- Se puede buscar un contacto o crear una ficha y después confirmar el vínculo.
- La interacción guarda procedencia y asunto acotado; no copia el cuerpo íntegro al CRM.
- Desvincular conserva el historial y evita volver a vincular automáticamente ese correo.

Una coincidencia de email **no verifica la identidad**. Las direcciones siguen marcadas como sin verificar. La normalización solo recorta espacios y convierte a minúsculas; no fusiona puntos ni alias `+` de Gmail.

Los mensajes importados con P04, sin la nueva marca de calidad de las cabeceras, exigen revisión manual. No se afirma que sus cabeceras hayan sido comprobadas retrospectivamente.

### Centro de agentes

- El formulario de borrador Gmail permite buscar y elegir un contacto real del CRM.
- La dirección destinataria se confirma manualmente. El servidor exige que corresponda a una única identidad activa del contacto.
- La aprobación sigue ligada al contenido exacto y el envío pasa por el Governed Runner.
- Si el trabajo está vinculado a una ficha real, los pasos de contacto/oportunidad/interacción/seguimiento usan el CRM local.
- UNKNOWN registra una interacción incierta, sin seguimiento de envío confirmado.
- COMMITTED, respaldado por la evidencia del flujo existente, registra la interacción y un solo seguimiento para revisar la respuesta 24 horas después.
- Repetir la consulta o reconciliar no repite el envío ni duplica el seguimiento.
- Los trabajos históricos con referencias de prueba conservan sus pasos simulados. La clasificación y el borrador inicial del workflow aún incluyen fixtures.

## 3. Uso del piloto que queda arrancado

Interfaz:

`http://127.0.0.1:5177/?workspaceApi=http%3A%2F%2F127.0.0.1%3A8907&tenant=m3-gmail-pilot#clients-screen`

- UI: puerto 5177. API: puerto 8907.
- Tenant: `m3-gmail-pilot`; propietario: `m3-test-owner`.
- Gmail conserva la conexión previa en Keychain.
- El directorio CRM del piloto sigue vacío. No se han introducido clientes ficticios en este espacio.
- Tras el reinicio se comprobaron los 27 correos locales: 23 recibidos y 4 enviados.
- Se abrió el diálogo CRM de un correo M3 enviado y se comprobó la exigencia de revisión manual de cabeceras anteriores. No se creó ni vinculó un contacto real.
- No se enviaron correos ni se modificó Gmail durante P05.

Para empezar: Clientes → Nuevo contacto → guardar su ficha; después, Nueva oportunidad / Programar seguimiento / Registrar nota. Tareas muestra los seguimientos guardados.

El script privado que ya existía permite arrancar la API piloto:

```bash
cd /Users/mac/Downloads/agent-world-os/pymes
python3 '/Users/mac/Library/Application Support/Autonomo OS/m3-pilot/launch.py'
```

No abrir una segunda API sobre el mismo journal. Los datos de sesión y OAuth permanecen fuera del checkout; este documento no incluye su contenido.

## 4. Arquitectura y persistencia

- `crm-contract.ts`: contratos públicos y validación estricta de comandos.
- `crm-store.ts`: proyección determinista por tenant y propietario.
- `crm-service.ts`: resolución de correo y adaptador del workflow.
- `crm-api.ts`: sesión, rol owner, namespace y rutas autorizadas.
- `crm-view.ts`: validación de respuestas en el cliente.
- `crm-screen.ts` / `crm-screen.css`: fichas, formularios, tareas e integración visual.
- `crm.test.ts` / `fixtures/crm-crash.ts`: pruebas sintéticas, replay, backup y SIGKILL real.

El store `pymesCrm` se registra **antes del restore** en el journal SQLite del runtime. El CRM comparte el archivo runtime.db existente, sin una base CRM adicional. Sus comandos guardan procedencia, revisión e idempotencia. Las mutaciones validan una copia antes de publicar el estado; un fallo no deja escrituras parciales en memoria.

Una revisión esperada impide sobrescribir cambios concurrentes dentro del proceso. Reusar commandId con el mismo contenido devuelve el resultado anterior; contenido diferente produce conflicto. La API deriva el propietario de la sesión y no admite fingir efectos o procedencia mediante comandos públicos.

La persistencia mantiene el modelo operativo de una API por journal. No se acredita concurrencia de múltiples procesos escribiendo el CRM. Para backup coordinado usar el procedimiento existente del runtime; la prueba de P05 verifica una copia del journal con el servicio cerrado, su restore y la recuperación del historial CRM. No acredita un nuevo procedimiento de backup online ni recuperación comercial completa del equipo.

El listado devuelve hasta 200 contactos y la búsqueda se realiza sobre toda la cartera. Un contacto solicitado explícitamente sigue disponible aunque sea antiguo. Las tareas se limitan a 100 resultados por vista, con aviso de recorte. La ficha acota identidades, oportunidades, interacciones y vínculos a 100; auditoría a 50. La interfaz actual filtra relación sobre el resultado acotado del directorio. Paginación completa y benchmarking de carteras grandes siguen pendientes.

El store tiene límites de capacidad y clona la proyección para cada mutación. Es adecuado para evaluar el piloto; no se ha medido todavía su rendimiento con una cartera profesional grande. Los cuerpos de correo mantienen la política de P04; no se añade una promesa de retención automática ni un borrado definitivo de datos CRM.

## 5. Rutas

Todas requieren sesión owner del workspace:

```text
GET  /v1/workspaces/<tenant>/crm?q=&contactId=&taskStatus=pending|done|cancelled|all
POST /v1/workspaces/<tenant>/crm/commands
POST /v1/workspaces/<tenant>/crm/resolve
POST /v1/workspaces/<tenant>/crm/link
```

`resolve` y `link` validan que el mensaje sea accesible para el propietario y la cuenta actual; comprueban nuevamente sesión y cuenta después de esperas asíncronas. Una cuenta nueva no expone mensajes de la anterior. Desconectado se puede usar la caché propia, conforme a P04.

## 6. Pruebas realmente ejecutadas

| Comprobación | Resultado |
| --- | --- |
| Suite completa `npm test` | 873 pruebas descubiertas: 872 pasan, 0 fallos, 1 omitida (Orca opt-in) |
| PYMES dentro de la suite | 482 pasan, 0 fallos |
| CRM P05 | 16 pasan, 0 fallos |
| Typecheck de todos los workspaces | Pasa |
| Build de todos los workspaces | Pasa |
| Tras los ajustes finales de UI y texto de evidencia | 16 CRM vuelven a pasar; typecheck y build de PYMES pasan |
| `git diff --check` | Pasa |

Cobertura relevante: aislamiento por propietario/tenant; rol/sesión; validación de entradas y respuestas; CAS e idempotencia; email exacto sin verificar identidad; revisión de ambigüedad y Reply-To; cabeceras duplicadas; cambios de sesión/cuenta durante consultas; API→cliente→journal; workflow real con proveedor sintético pasando por C11; UNKNOWN→reinicio→reconciliación con un solo envío; SIGKILL real de proceso tras persistencia; restore de backup; contacto antiguo en directorio acotado.

Revisión visual en un tenant **sintético separado**, con su SQLite propio y sin Gmail:

1. Crear contacto de prueba.
2. Crear oportunidad de RC profesional.
3. Programar seguimiento.
4. Verlo en Tareas, marcarlo hecho y filtrar Hechos.
5. Registrar nota y consultar historial.
6. Buscar sin coincidencias y comprobar que desaparece el detalle anterior.
7. Reiniciar API, recargar interfaz y comprobar que todo permanece.
8. Revisar escritorio y ancho 390 px; sin desbordamiento horizontal.

Capturas en Downloads:

- `AUTONOMO_OS_CRM_P05_2026-10-04.png` — expediente completo de escritorio.
- `AUTONOMO_OS_CRM_MOVIL_P05_2026-10-04.png` — revisión en ancho estrecho.
- `AUTONOMO_OS_TAREAS_P05_2026-10-04.png` — seguimiento pendiente antes de completarlo.

La API de QA quedó detenida y sus pestañas cerradas. Las capturas muestran datos ficticios. El selector de contactos del formulario del runtime pasa typecheck/build; el recorrido visual completo de ese selector con un nuevo trabajo Gmail no se ha ejecutado en esta entrega.

## 7. Qué queda

1. Aceptación adicional del inbox Gmail real: nuevo mensaje entrante, movimientos de etiquetas/archivado/spam/papelera, cursor 404 y purga local consentida. No se ejecutó una purga real.
2. M4.3: clasificación y resumen del correo real con el modelo configurado, procedencia, estados y control del contexto enviado al modelo.
3. M4.4: correo entrante → revisión del contacto → preparación de respuesta → aprobación exacta → envío gobernado → interacción/seguimiento. Partes del workflow siguen con fixtures; P05 no acredita todo ese recorrido contra Gmail real.
4. Selector CRM del runtime y envío gobernado vinculado a un contacto del piloto: validar el recorrido real, con una ficha y contenido autorizados.
5. Respuestas en hilo y vinculación de duplicados entre interacción de efecto y correo sincronizado: no se fusionan heurísticamente en P05.
6. Google Calendar, aseguradoras/propuestas reales, WhatsApp, Telegram, iMessage y sincronización con CRM externo: no quedan activados por P05.
7. Importación CSV sigue fuera del alcance acordado de M4.
8. Antes de vender: aceptación operativa en equipo objetivo, rendimiento, copias/recuperación completas, política de retención y tratamiento de datos, empaquetado/actualización y soporte. P05 no declara el producto comercialmente terminado.

No hay cambios en C1–C12 ni un sender nuevo. Las notas o el contenido de correo no conceden permisos de ejecución.
