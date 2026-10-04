# P10 — Cancelación durable de trabajos de correo

Actualizado: 2026-10-05. Nombre de documento solicitado: 2026-10-04.

## 1. Identificación y resultado

- Checkout: `/Users/mac/Downloads/agent-world-os`.
- Rama: `codex/h4-http-api`.
- Base inspeccionada, inicialmente limpia: `8eed71c2f7049b95ecda30af802ea3a0c61834df` (P09).
- Implementación: `d8eea4487a859eb8c61ce83ee5fb82d215a40c3a`.
- **SHA final del código P10 validado:** `3cbf7b6e413eb612517324a729c51358d7584e80`.
- El commit posterior de entrega añade este informe y las capturas; no modifica el código validado. Su SHA se comunica en la entrega y se incorpora a la copia de Downloads después del commit.
- **P10 implementado y validado. P11 no iniciado.**

Se inspeccionaron Git, contratos del kernel, persistencia, C6, email workflow,
revisionado P08, cola P09 y CRM antes de modificar. El baseline específico de
correo pasó **35/35** pruebas antes de empezar.

## 2. Implementación

### Contrato y registro durable

Nuevos módulos:

- `pymes/src/mail-cancellation-contract.ts`: validación compartida entre host y cliente.
- `pymes/src/mail-cancellation-store.ts`: proyección append-only del journal existente, registrada como `pymesMailCancellations` antes del replay.
- `pymes/src/mail-cancellation-screen.ts`: acciones, confirmaciones y errores de la pantalla.

La petición contiene:

```json
{
  "requestId": "identificador-unico-de-la-peticion",
  "expectedRevision": 1,
  "expectedStateHash": "sha256-del-estado-durable-mostrado",
  "reason": null,
  "confirmed": true
}
```

`expectedRevision` es la versión de respuesta de P08, no el texto mostrado en la
UI. La huella añade la tarea, unidades, intentos, claims C6, origen, borrador,
revisión, decisión, política y sucesor existentes. Se vuelve a comprobar dentro
de la transacción. Un cambio de contenido o aprobación invalida la confirmación,
aunque la versión de respuesta siga siendo la misma. Los campos opcionales se
normalizan como en su representación JSON antes de calcular la huella.

El registro durable conserva task id, tenant, owner, actor, motivo opcional,
timestamp, versión de respuesta esperada, versión del plan, estado anterior,
request id, hash de petición y hash del estado esperado. El servidor fija actor,
tenant y timestamp; el cliente no puede suministrarlos ni cambiarlos.

En una sola transacción del journal se guardan:

1. El registro de cancelación.
2. `DecisionRecorded`, referenciado al registro.
3. `EvidenceRecorded`, con una referencia distinta derivada del registro.
4. `GlobalTaskCancelled`, usando la transición existente del kernel.
5. Auditoría `job.cancelled.user`.

No se creó otro kernel, sender, journal, runner ni base de datos de cancelaciones.
No hay cambios en los paquetes C1–C12 ni en el proveedor Gmail M3.

### API y cliente

Nuevas rutas autenticadas:

```text
POST /v1/workspaces/<tenant>/runtime/<task>/email/cancel
POST /v1/workspaces/<tenant>/runtime/<task>/email/reprepare
```

La cancelación requiere owner del workspace y propiedad de la tarea. Se comprueba
la sesión otra vez antes de publicar. Revisor/agente no pueden cancelar ni
repreparar; sus respuestas de lectura tampoco habilitan esos botones, incluso si
usan el mismo user id del propietario.

Cancelar es una decisión local y no consulta Gmail antes de persistir. Puede
cancelarse un borrador todavía seguro aunque se haya desconectado su cuenta.
Los conflictos se devuelven como códigos explícitos, por ejemplo
`EMAIL_CANCEL_STALE`, `EMAIL_CANCEL_C6_CLAIM`, `EMAIL_CANCEL_UNKNOWN`,
`EMAIL_CANCEL_ACTIVE_ATTEMPT` o `EMAIL_CANCEL_EXTERNAL_DISPATCH`.

`WorkspaceClient` valida la petición y los controles recibidos. Las respuestas
anteriores sin los nuevos campos siguen siendo compatibles.

## 3. Estados permitidos y bloqueados

Los siguientes casos son escenarios comprobados, no una decisión basada
únicamente en el estado visual de la pantalla:

| Estado / condición real | Cancelación |
| --- | --- |
| Borrador vinculado a correo, antes de evaluación/aprobación, sin intentos activos ni claims | Permitida |
| Contenido rechazado, pasos internos ya terminados, sin envío iniciado | Permitida |
| Contenido aprobado, revisión interna terminada, antes de claim C6/envío | Permitida |
| Intento creado/reservado/activo, incluso sin claim C6 | Rechazada |
| Dispatch externo iniciado, incluso si luego terminó con fallo y no quedó activo | Rechazada |
| Cualquier claim C6 de `email.send` perteneciente a la tarea, incluso de una revisión anterior o fallido | Rechazada |
| UNKNOWN en tarea/intento o pendiente de reconciliación | Rechazada |
| COMMITTED/completado | Rechazada |
| Tarea terminal fallida, cancelada o sustituida | Rechazada como nueva cancelación |
| Misma petición ya confirmada, con mismo task/owner/tenant/contenido | Devuelve la decisión existente |
| Mismo request id usado con otra petición/tarea | Conflicto |
| Huella o revisión desactualizadas | Conflicto; exige actualizar la vista |
| Runtime cerrado, journal no saludable, operación concurrente en el host | Rechazada |
| Trabajo legado sin procedencia MailTask de P07/P08 | No se ofrece esta operación |

Los pasos de preparación/revisión CRM terminados dentro del host tienen eventos
internos de dispatch. No representan un dispatch externo de correo. El chequeo
bloquea el WorkUnit de envío y cualquier proveedor externo o desconocido que
haya iniciado dispatch; también bloquea cualquier intento interno todavía activo.
Esto permite cancelar después de un rechazo/aprobación ya terminados sin
relajar la protección del envío.

## 4. Invariantes

- Nunca se transforma UNKNOWN en cancelled/failed.
- No se borran claims, observaciones, reconciliaciones, aprobaciones ni evidencia.
- La cancelación no llama al proveedor de correo.
- El kernel deja la tarea terminal y sus unidades pendientes canceladas.
- Evaluar, modificar borrador o ejecutar el trabajo cancelado se rechaza.
- La aprobación anterior permanece legible; no autoriza la tarea sucesora.
- Se inspeccionan todos los claims de envío de la tarea, no solo los de la revisión visible.
- La comprobación de estado y la publicación de cancelación no contienen un await.
- La exclusión existente por tarea coordina evaluación, decisión, ejecución,
  revisión, cancelación y repreparación en el host.
- Repetir una petición confirmada no añade decisiones, evidencia ni auditorías.
- Si la transacción falla después de mutar proyecciones, se conserva el mecanismo
  existente de journal no saludable hasta restaurar; no se devuelve una vista ficticia.
- C1–C12, replay, C6/UNKNOWN, Governed Runner, M3 y P03–P09 conservan sus contratos.

## 5. Repreparar desde el mismo correo

Es una operación explícita que requiere el id de la cancelación durable.

- Repetir la creación habitual de MailTask desde ese email devuelve la tarea
  existente, aunque esté cancelada. No la reactiva ni crea una versión oculta.
- `reprepare` crea un task id distinto, incrementa la versión de respuesta,
  conserva origen y registra `revisesTaskId`.
- Se reutiliza el mecanismo de sucesores de P08; no se cancela otra vez ni se
  añade auditoría al trabajo ya cancelado.
- La tarea/registro/revisión/decisión/auditoría del trabajo cancelado permanecen
  inmutables. La relación nueva se consulta desde la proyección de bindings.
- El sucesor empieza con borrador, sin revisión ni aprobación heredadas.
- Volver a enviar exige una revisión y una aprobación nuevas.
- Repetir `reprepare` con la misma cancelación devuelve el mismo sucesor.
- Antes de crear se comprueban correo, cuenta, contexto del proveedor, contacto,
  identidad destinataria y sesión usando los contratos existentes.

## 6. CRM

Cancelar no produce una interacción outgoing ni un seguimiento enviado.
Se mantiene el contexto/lead que ya hubiera creado la preparación anterior.

El adaptador CRM busca el ancestro más próximo que realmente llegó a preparar
su contexto. Así funciona una cadena con borradores cancelados antes de llegar
al CRM: no se referencia un workflow inexistente y tampoco se duplica una
oportunidad ya preparada en un ancestro anterior. `CrmStore` y sus comandos de
replay no se modificaron.

## 7. Interfaz

En Centro de agentes:

- `Cancelar trabajo` aparece cuando los controles del servidor lo permiten.
- La confirmación muestra cliente, destinatario, asunto, versión de respuesta,
  estado registrado y aprobación existente.
- Botón explícito `Cancelar este trabajo`, con motivo opcional.
- Aviso: cancelar no equivale a borrar el historial.
- Después: `CANCELLED · Cancelado por el profesional`, actor, hora y motivo.
- Aprobación anterior visible; borrador/revisión conservados en modo histórico.
- No hay botón de envío/evaluación ni formulario editable en la versión cancelada.
- `Preparar nueva versión desde este correo` abre otra confirmación y crea otro trabajo.
- Una confirmación que falla muestra el error real y conserva los datos del
  trabajo. No cambia el estado a CANCELLED por optimismo ni usa datos demo como fallback.
- La petición conserva su request id durante el reintento después de una respuesta
  perdida. Una actualización consulta la decisión durable del servidor.

## 8. Pruebas y gates ejecutados

**28 pruebas nuevas de P10, 28 pasan.**

Archivos:

- `pymes/tests/mail-cancellation.test.ts`.
- `pymes/tests/mail-cancellation-crash.test.ts`.
- `pymes/tests/mail-cancellation-screen.test.ts`.
- Fixtures de fallo/crash/QA bajo `pymes/tests/fixtures/mail-cancellation-*`.

Cobertura: cancelación antes de aprobación, después de rechazo y después de
aprobación; rechazo con C6, C6 fallido antes del POST, intento activo, dispatch
externo ya terminado, UNKNOWN y COMMITTED; idempotencia, concurrencia en un
host, conflicto de request id, revisión/huella desactualizadas, respuesta perdida,
sesión revocada, tenant/owner/roles, desconexión, restart, replay, mismo correo y
nueva aprobación, cadenas con/sin contexto CRM previo, controles malformados y
mensajes de error sin confirmación ficticia.

Gates finales sobre el código identificado en la sección 1:

| Gate | Resultado |
| --- | --- |
| `npm test` | **945 descubiertas; 944 pasan; 0 fallan; 1 omitida; 0 canceladas** |
| Suite PYMES dentro del monorepo | **550/550 pasan** |
| `npm run typecheck --workspaces --if-present` | Exit 0 |
| `npm run build` | Exit 0 |
| `git diff --check` y revisión del diff staged | Sin errores |

La única omitida es el probe opcional live de Orca (`live Orca probe is opt-in
and performs no worker launch`). No pertenece a P10.

### SIGKILL / recovery

Cada punto usa un proceso Node real, envío ficticio y journal SQLite propio:

| Punto de SIGKILL | Estado tras restaurar |
| --- | --- |
| `beforePersist`, después de aprobar y antes de iniciar la transacción | Aprobación conservada; ninguna cancelación/auditoría parcial |
| `afterTransition`, con registro y eventos escritos dentro de la transacción aún sin commit | Rollback completo; continúa aprobado, sin cancelación parcial |
| `afterPersist`, después del commit antes de responder | Cancelación y auditoría únicas conservadas; aprobación histórica legible |

Se verifica la señal SIGKILL, se reabre, se repite la misma petición, se vuelve a
restaurar/replay y se intenta ejecutar. Después de la cancelación confirmada se
rechaza la ejecución; en todos los casos el contador de envíos permanece en cero.

## 9. QA visual aislado

QA en `http://127.0.0.1:8935`, UI Vite en 5177, tenant ficticio `agency`.
Persistencia aislada: `/Users/mac/Library/Application Support/Autonomo OS/p10-qa`.

Cuenta/contacto/email/modelo/proveedor de envío de fixtures. **No se usaron los
correos, tokens, Keychain, cuenta ni journal reales del piloto como fixtures.**
No se enviaron mensajes reales ni se reejecutó la prueba M3 del piloto.

Recorrido realmente observado en navegador:

1. Sesión autorizada y borrador de Consulta RC con cliente ficticio.
2. Abrir confirmación y modificar el borrador durable desde otro control del QA.
3. Confirmar la vista antigua: API rechaza por `EMAIL_CANCEL_STALE`; mensaje real
   visible, sin datos demo ni CANCELLED inventado.
4. Actualizar, comprobar datos y cancelar con motivo.
5. Consultar borrador/auditoría conservados: cancelado, sin dispatch.
6. Crear explícitamente versión 2, con id nuevo y sin aprobación.
7. Evaluar/aprobar versión 2 y cancelarla antes de claim/envío.
8. Reiniciar el servidor QA y actualizar: ambas versiones siguen canceladas,
   aprobación histórica visible. Contadores del sender: **0 calls, 0 sent**.

Capturas guardadas en Downloads y versionadas en `docs/handoff/evidencias/p10`:

- [Error real de vista desactualizada](evidencias/p10/AUTONOMO_OS_P10_ERROR_REAL_2026-10-04.png).
- [Confirmación antes de aprobación](evidencias/p10/AUTONOMO_OS_P10_CONFIRMACION_2026-10-04.png).
- [Borrador cancelado e historial](evidencias/p10/AUTONOMO_OS_P10_CANCELADO_2026-10-04.png).
- [Confirmación con aprobación previa](evidencias/p10/AUTONOMO_OS_P10_APROBADO_CONFIRMACION_2026-10-04.png).
- [CANCELLED y aprobación histórica](evidencias/p10/AUTONOMO_OS_P10_CANCELADO_APROBADO_2026-10-04.png).

### Reproducir el QA

Desde el checkout, con la UI Vite en 5177 y 8935 libre:

```bash
node --import tsx pymes/tests/fixtures/mail-cancellation-browser-qa.ts /ruta/a/directorio-qa-vacio
```

Abrir UI con `workspaceApi=http://127.0.0.1:8935&tenant=agency`, conectar usando
la sesión **sintética** mostrada por el fixture y abrir Centro de agentes.
El proceso acepta `stale`, `status` y `stop` en stdin. `stale` altera exclusivamente
el borrador ficticio para comprobar el error real de revisión desactualizada.
No pasar una ruta del piloto ni de producción como directorio QA.

## 10. Límites y decisiones para P11

1. Operación manual para trabajos MailTask vinculados de P07/P08/P09; no es una
   API genérica de cancelación de cualquier tarea AW2 ni de operaciones externas.
2. Solo owner. Delegar cancelaciones a otros roles exigiría una decisión de
   producto y autoridad explícita; no se habilitó aquí.
3. `canReprepare` informa elegibilidad del ciclo de vida. La validación posterior
   todavía puede rechazar cambios de cuenta/contacto/correo o fuente purgada.
   P10 no vuelve a clasificar una fuente cambiada ni rebaja sus comprobaciones.
4. El sucesor conserva destinatario, contexto y datos de seguimiento de P08; no
   recalcula automáticamente la fecha del seguimiento ni inventa otra acción.
5. Límite existente de 100 versiones por cadena; store de cancelaciones acotado
   a 50.000 registros por tenant. No se añadió compactación/borrado del historial.
6. La exclusión de operaciones es por tarea y proceso, conforme al host actual.
   No se acredita un despliegue con dos runtimes escritores simultáneos sobre
   el mismo journal. Mantener un host escritor; soportar varios exigiría fencing
   del host antes de ampliar ese despliegue.
7. No se certificó P10 con correos personales/piloto reales: la prueba visual y
   los fallos son aislados, como se solicitó. La regresión Gmail M3 usa sus tests
   existentes; no se modificaron OAuth, Keychain ni reconciliación.
8. El servicio del piloto en 8907 se reinició de forma controlada con P10, tras
   crear `backup-before-p10-runtime.db` mediante backup SQLite consistente,
   con permisos 0600, en su carpeta privada. El arranque recuperó el journal.
   La consulta posterior conservó 4 trabajos: 3 completados y el UNKNOWN
   legado M3-A. No se canceló, preparó ni envió ningún trabajo real.

**No hay trabajo de P11 iniciado.** Estas condiciones deben mantenerse al diseñar
el siguiente paso; no autorizan reactivar tareas canceladas ni reenviar UNKNOWN.
