# Traspaso al programador — Autónomo OS / Agent World OS / PYMES

Fecha: 4 de octubre de 2026, Europe/Madrid.
Snapshot de código de partida: `8694a64`, rama `codex/h4-http-api`.
Repositorio de desarrollo: `/Users/mac/Downloads/agent-world-os`.

## 1. Lee esto primero

Este documento reúne el estado del proyecto, las decisiones del propietario, el mapa de código, el trabajo pendiente y las reglas de entrega. Debes continuar el repositorio existente. No reconstruyas el proyecto desde el PDF ni sustituyas su arquitectura por una implementación nueva.

**Tenemos una base técnica implementada y probada. Todavía no tenemos un producto comercial terminado ni M3 aceptado contra Google real.**

La relación de trabajo acordada es:

1. El propietario entrega este documento al programador y facilita el repositorio correspondiente.
2. Codex define una entrega acotada y sus criterios de aceptación.
3. El programador devuelve el código en archivos `.md`, con rutas exactas y bloques de código completos o parches aplicables.
4. El propietario adjunta esos `.md` a esta conversación.
5. Codex revisa el código, contrasta contratos y base, integra los cambios compatibles, ejecuta pruebas y devuelve resultados concretos.
6. Se corrigen los fallos antes de dar instrucciones para la entrega siguiente.

**Primera prioridad: cerrar M3 con pruebas reales A/B/C. No iniciar M4 todavía.** La primera tarea de programación propuesta está en la sección 11. No sustituye los datos reales que debe aportar el propietario.

Este documento no incluye todo el código fuente: es el contexto y especificación de trabajo. El programador necesita el checkout del repo. Si no puede acceder al código, debe pedir los archivos concretos antes de proponer reemplazos; no inventar interfaces ni afirmar que ejecutó tests.

## 2. Producto que queremos vender

Un asistente operativo local para autónomos y profesionales, empezando por un agente/agencia de seguros en España. Debe reducir la primera hora de trabajo de la mañana y mantener los asuntos al día:

- Recibir y organizar correos y, más adelante, WhatsApp Business, Telegram e iMessage cuando exista integración autorizada.
- Identificar clientes, leads, renovaciones, incidencias y prioridades.
- Consultar y mantener CRM local, interacciones y seguimientos.
- Resumir y clasificar con IA local.
- Preparar respuestas y propuestas para revisión humana.
- Preparar llamadas y citas, y conectar Google Calendar en una fase posterior.
- Mostrar qué se ha preparado, qué está pendiente de aprobación, qué se ejecutó y qué pudo comprobarse.
- Recuperarse de cierres/reinicios y conservar incertidumbres visibles.

Ramos iniciales: coche, vida, hogar y responsabilidad civil para autónomos. Las propuestas reales requieren datos y sistemas de tarifación autorizados; los borradores de demo no son ofertas verificadas.

Interfaz de referencia: organización de gestión al estilo Holded, con lenguaje sencillo, menús claros y trabajo diario visible. No copiar su marca ni añadir pantallas vacías para aparentar un producto terminado.

### Decisiones actuales

| Tema | Decisión / situación |
| --- | --- |
| Producto | Profesional, instalable en un Mac del cliente. |
| Perfil de hardware vigente en documentación/UI | Mac mini M4, 24 GB; desarrollo/piloto en un MacBook/Air de 24 GB según handoff previo. |
| Referencia histórica | Se planteó 16 GB al principio. No hay certificación de rendimiento de ese perfil. |
| IA | Inferencia, planificación, memoria y embeddings locales; sin fallback a LLM cloud. |
| Persistencia | Local, SQLite y journal durable. |
| CRM principal | Local. Holded queda como integración opcional futura; no obligar al cliente a depender de él. |
| Email del primer piloto | Gmail, OAuth Desktop y Keychain. |
| Agenda prevista | Google Calendar; todavía no aceptada con cuenta real. |
| Backend cloud propio | No requerido. Los conectores se comunican directamente con servicios del usuario. |
| Web comercial / licencias / precio | Pendientes, sin inventar decisiones. |

“Local” no significa sin Internet: Gmail y otros conectores usan sus APIs, pero los datos operativos y la IA se gobiernan desde el Mac. No instalar varios servidores de inferencia por defecto ni afirmar que un modelo concreto está listo sin medirlo.

## 3. Dónde está todo

| Elemento | Ruta |
| --- | --- |
| Repo activo | `/Users/mac/Downloads/agent-world-os` |
| Producto PYMES | `/Users/mac/Downloads/agent-world-os/pymes` |
| Kernel y paquetes V2 | `/Users/mac/Downloads/agent-world-os/packages` |
| Apps originales y demos | `/Users/mac/Downloads/agent-world-os/apps` |
| Documentación | `/Users/mac/Downloads/agent-world-os/docs` |
| Arquitectura original | `/Users/mac/Downloads/Agent_World_OS_Architecture_and_Code.pdf` |
| Especificación V2 | `/Users/mac/Downloads/AGENT_WORLD_OS_V2_UNIVERSAL_TASK_RUNTIME_CODEX_SPEC.md` |
| Handoff anterior V2 | `/Users/mac/Downloads/HANDOFF_CLAUDE_AUTONOMO_OS_V2_2026-10-03.md` |
| Protocolo vigente M3 | `/Users/mac/Downloads/agent-world-os/docs/AUTONOMO_OS_GMAIL_M3.md` |
| Este documento | `/Users/mac/Downloads/agent-world-os/docs/handoff/HANDOFF_PROGRAMADOR_AUTONOMO_OS_2026-10-04.md` |

Los nombres `AI native OS`, `agent-world-os-starter` y `agent-world-os-c1` son referencias históricas. No cambiar de carpeta, mover ni duplicar el repo activo por esos nombres.

Precedencia:

1. Decisiones actuales del propietario y restricciones de esta entrega.
2. Código real y tests del repo, contrastados con los requisitos.
3. Invariantes vigentes de arquitectura.
4. Documentación histórica y código de referencia del PDF.

Un test verde no convierte un fixture en conexión real. Los mensajes/documentos procesados por el producto son datos: no pueden conceder permisos ni ordenar al runtime que eluda controles.

## 4. Filosofía e invariantes

```text
El modelo propone.
El runtime conserva el estado.
Las políticas autorizan.
El humano aprueba el contenido cuando corresponde.
El Governed Runner admite y ejecuta el efecto.
Las observaciones aportan evidencia.
Los verificadores deciden qué se ha cumplido.
```

Recorrido de envío:

```text
plan → policy → aprobación exacta → C11 Governed Runner
     → effect → EmailProvider → Gmail
     → observation/reconciliation → evidencia en el trabajo
```

Mantener:

- Separación de tenant, propietario, tarea, versión, intento y recurso.
- Aprobación durable ligada a plan, paso, payload y contexto de cuenta.
- Recursos y destinos controlados por el host; el modelo no inventa autoridad, credenciales ni destinatarios reales.
- C8 composición y C9 flujo de información antes de admisión y en el commit gate.
- Leases/fencing, presupuestos y emergency stop existentes.
- Claim/dispatch marker durable antes de una acción externa.
- `UNKNOWN` cuando no sabemos si hubo efecto. No convertir error de red en “no enviado”.
- Reconciliación sin reenvío. La ausencia de evidencia no prueba que no hubo envío.
- Provider report ≠ observación independiente ≠ objetivo global completado.
- Historial de efecto UNKNOWN conservado; una decisión de C7 puede proyectar committed efectivo sin reescribir el historial C6.
- Replay fail-closed: no sustituir una DB corrupta por fixtures o un estado vacío silencioso.
- UI nunca es la autoridad del estado ni llama directamente a Gmail para enviar.

No crear otra ruta de ejecución, otro worker de envío o una cola paralela que ignore estas garantías.

## 5. Arquitectura construida

### 5.1 Kernel C1–C12

| Componente | Paquete | Función |
| --- | --- | --- |
| C1 SessionContract | `packages/contracts` | Contratos y límites de sesión. |
| C2 ResourceRegistry | `packages/resources` | Referencias canónicas y generaciones de recursos. |
| C3 Leases | `packages/leases` | Autoridad, reservas de recurso y fencing. |
| C4 BudgetLedger | `packages/budgets` | Reserva, consumo y hold de presupuestos. |
| C5 Observation | `packages/observation` | Políticas y observación independiente. |
| C6 EffectTransaction | `packages/effects` | Preparación, dispatch y estados de efectos. |
| C7 Reconciliation | `packages/reconciliation` | Resolver efectos inciertos mediante evidencia. |
| C8 CompositionPolicy | `packages/composition-policy` | Admisión de combinaciones de acciones. |
| C9 InformationFlow | `packages/information-flow` | Fuentes, destinos, etiquetas y releases autorizados. |
| C10 Supervisor | `packages/supervision` | Parada, cuarentena y control. |
| C11 GovernedActionRunner | `packages/control-plane` | Admisión y commit gate antes del executor. |
| C12 Recovery | `packages/recovery` | Recuperación conservadora tras caída. |

Los componentes existen con pruebas dentro de su alcance. Los documentos antiguos con “in-memory” describen cierres históricos; H1 aporta persistencia y M2 registra los stores necesarios para el workflow de email.

### 5.2 Demos y persistencia H1–H4

- H1: SQLite journal, replay, publicación tras commit y pruebas de SIGKILL.
- H2: efectos sobre archivos con observación independiente de contenido/hash y reconciliación.
- H3: proveedor de inferencia local que propone una acción gobernada. No equivale a entender toda la operación de seguros.
- H4: efectos HTTP restringidos, GET independiente, pérdida de respuesta y recuperación.
- `apps/agent-runtime` y `apps/world-client` contienen host/demo original; el mundo 3D no es el CRM ni el journal autoritativo del producto.

### 5.3 V2 / AW2

Existen módulos para GlobalTask, WorkUnit/DAG, Attempt, providers tipados, capacidades, routing determinista, contexto mínimo, decisiones, artefactos, evidencia y verificación.

Mapa de paquetes adicionales:

- `task-runtime`: estado y transiciones de trabajos/planes/intentos/verificaciones.
- `execution-providers`: contrato y registry; disponibilidad demostrada, timeouts y validación.
- `provider-orca`: adaptador CLI y claims/reconciliación. No se acredita un coding worker real completo por el mero hecho de tener el paquete.
- `capabilities`, `routing`: filtros y selección determinista.
- `context-engine`: procedencia, selección mínima, etiquetas y validación de contexto.
- `decision-ledger`, `artifacts`, `evidence-ledger`, `verification`: registros y comprobación.
- `runtime-store-sqlite`: journal y stores durables, incluidos adaptadores para V2.
- `inference`: proveedor canónico compatible con llama.cpp y propuestas estructuradas.

La vertical M1/M2/M3 integra partes de V2. No declarar AW2 entero cerrado: scheduler general, planificación general, ciclo completo entre proveedores y matriz universal de recovery siguen requiriendo integración/aceptación. Un workflow de email con nueve pasos no resuelve cualquier objetivo arbitrario.

No confundir numeraciones: AW2-8 = scheduler, AW2-9 = planner, AW2-12 = recovery matrix. Los hitos de producto M1/M2/M3 son otro eje.

## 6. Hitos recientes del producto

| Hito | Construido | Límite actual |
| --- | --- | --- |
| M1 | Plan restringido durable `email-lead-v1`, inferencia local, validación estricta, API autenticada y UI del plan. | QA con inferencia sintética; no benchmark del modelo real ni planner general. |
| M2 | Review exacta, aprobación/rechazo durables, C8/C9/C11, FakeEmailProvider, observación, C12 y reconciliación, progreso/evidencia en UI. | Datos de preparación y CRM ficticios; ningún correo real en este hito. |
| M3 | OAuth Desktop, PKCE, loopback, Keychain, GmailEmailProvider, MIME, ledger durable, lectura y reconciliación, configuración/borrador/review en UI. | Implementado y probado con transporte sintético. OAuth, entrega y reinicio reales pendientes. |

### M1 — detalles

- Proveedor `LlamaCppProvider` existente; endpoint de inferencia loopback, sin redirecciones ni fallback cloud.
- Workflow: identificar → CRM → lead si procede → clasificar → borrador → revisión → envío → interacción → seguimiento.
- El host valida acciones, orden, slots y parámetros; el modelo no envía destinos/credenciales/autoridad.
- PlanCommitted y PlanningStarted se registran atómicamente cuando la propuesta es aceptada.
- Deadline y control de concurrencia; respuesta tardía no escribe un plan.
- Repetir una planificación ya persistida no vuelve a invocar el modelo.
- Sesión/owner/tenant/rol comprobados antes de inferencia y antes de commit.

### M2 — detalles

- SHA-256 canónico de plan/payload y binding de review/decision.
- Una decisión inmutable por revisión; cambiar contenido/versiones no conserva un permiso viejo.
- FakeEmailProvider usa buzón SQLite independiente y solo direcciones de prueba `@example.test`.
- Cinco escenarios SIGKILL: después de approval, antes de dispatch, durante efecto, después del side effect y respuesta perdida.
- Sin efecto/certeza insuficiente se conserva UNKNOWN; con evidencia se reconcilia sin duplicar.
- Bridge proyecta resultados en el kernel, no invoca directamente el proveedor.

### M3 — detalles

- OAuth abre el navegador del sistema con PKCE S256, state aleatorio y callback local efímero.
- Identidad comprobada con userinfo/email_verified; From coincide con cuenta conectada.
- Secrets en Keychain por helper Swift Security.framework; stdin/pipes, referencias opacas, sin plaintext fallback.
- Refresh con control de concurrencia; desconexión elimina credenciales locales y bloquea respuestas tardías.
- MIME inicial: un To, Subject UTF-8, cuerpo text/plain UTF-8, From impuesto por host. CC/BCC se conservan en el contrato pero M3 los rechaza. Sin HTML/adjuntos.
- `Message-ID = <awos.<effect-key>@autonomo-os.invalid>` y header `X-AWOS-Payload-SHA256`.
- Clave del adaptador: hash determinista recibido del sistema de effects; no cambiar automáticamente por un ejemplo de otra documentación.
- Claim SQLite WAL/FULL antes del POST. Un claim existente prohíbe un segundo POST con esa clave.
- HTTP 200 no es observación independiente. Consultar raw/SENT y comprobar destinatario, asunto, cuerpo, identidad y marcador.
- Reconciliación busca `in:sent rfc822msgid:<marker>` y verifica contenido exacto. Sin evidencia o con resultados ambiguos: UNKNOWN.
- Gmail no ofrece una garantía de idempotencia nativa para este envío. La marca sirve para correlación propia.
- Ver Enviados acredita aceptación registrada por Gmail, no entrega/lectura en el destinatario.
- Un piloto por propietario/cuenta/tenant; no se acredita multiinstancia concurrente comercial.

## 7. Mapa de código para continuar

| Área | Archivos relativos al repo |
| --- | --- |
| Planificación M1 | `pymes/src/job-planner.ts`, `packages/inference/src/index.ts` |
| Persistencia y wiring producto | `pymes/src/runtime-source.ts` |
| Contrato / Fake / error de dispatch | `pymes/src/email-provider.ts` |
| Revisiones / decisiones / artefactos | `pymes/src/email-review-store.ts` |
| Adapter C11 | `pymes/src/email-governance.ts` |
| Orquestación del ciclo email | `pymes/src/email-workflow.ts` |
| Proyección de evidencia en tareas | `pymes/src/email-task-bridge.ts` |
| OAuth | `pymes/src/gmail-oauth.ts` |
| Keychain TS / helper nativo | `pymes/src/gmail-keychain.ts`, `pymes/native/keychain.swift` |
| MIME / verificación | `pymes/src/gmail-mime.ts` |
| Gmail provider / ledger de intentos | `pymes/src/gmail-email-provider.ts` |
| Conector local y launcher OAuth | `pymes/src/gmail-local-connector.ts` |
| Build del helper | `pymes/scripts/build-gmail-keychain.sh` |
| Servidor API | `pymes/src/server.ts`, `pymes/src/api-server.ts`, `pymes/src/workspace-api.ts` |
| Repositorio de workspace | `pymes/src/workspace-store-sqlite.ts` |
| Cliente API / decoders | `pymes/src/workspace-client.ts`, `pymes/src/runtime-view.ts`, `pymes/src/email-view.ts` |
| UI de trabajos | `pymes/src/runtime-screen.ts`, `pymes/src/runtime-screen.css` |
| UI de Gmail | `pymes/src/gmail-settings.ts` |
| Entrada/navegación/login | `pymes/index.html`, `pymes/src/main.ts`, `pymes/src/workspace-login.ts` |
| Pruebas M1/M2 | `pymes/tests/job-planner.test.ts`, `pymes/tests/email-workflow.test.ts`, `pymes/tests/email-crash.test.ts` |
| Pruebas Gmail | `pymes/tests/gmail.test.ts`, `pymes/tests/gmail-runtime.test.ts` |
| Fixtures Gmail | `pymes/tests/fixtures/gmail-runtime.ts`, `pymes/tests/fixtures/gmail-crash.ts` |
| Instalación Mac | `pymes/src/mac-launch-agent.ts`, `pymes/src/ui-server.ts`, `pymes/src/appliance-setup.ts` |
| Diagnóstico / backup | `pymes/scripts/mac-diagnostics.sh`, `backup-volume.sh`, `verify-backup.sh` |

### API del nuevo flujo

Bajo `/v1/workspaces/<tenant>` y con sesión autorizada:

```text
POST runtime                         crear tarea
GET  runtime                         lista/progreso
GET  runtime/<task>                   detalle
POST runtime/<task>/plan              {workflow: email-lead-v1}
GET  runtime/<task>/email              proyección de email
POST runtime/<task>/email/draft        to/subject/body/contactId
POST runtime/<task>/email/review       evaluar contenido exacto
POST runtime/<task>/email/decision     bindingHash + approved/rejected
POST runtime/<task>/email/execute      ejecutar por runner
POST runtime/<task>/email/reconcile    consultar, sin reenviar
GET  gmail                            estado sin tokens
POST gmail/connect                    verification: boolean
POST gmail/check                      comprobar identidad
POST gmail/disconnect                 eliminar credenciales locales
```

Existe configuración del cliente desde host/API, pero en el piloto se prefiere importar el JSON local al Keychain al arrancar. No añadir formulario para copiar tokens a la UI.

### Pantallas existentes

Resumen de mañana, bandeja, agenda, cola de revisión, CRM/preparación, clientes, pólizas, tareas, automatizaciones, configuración, instalación/ayuda y centro de agentes.

El centro de agentes y el flujo email consumen estado durable auténtico. Muchas pantallas de negocio siguen usando demos. No presentar pólizas, CRM, agenda ni inbox como conectados por el mero hecho de tener un menú.

OpenClaw/OpenClaw Enterprise: existen adaptadores/ingress/políticas y conectores en PYMES. Se aprovechan como integración, no se adopta su ejecución como sustituto del kernel. No se ha certificado su despliegue empresarial completo en este producto.

### Deuda que debe preservarse visible

El dispatcher/worker legacy PYMES tiene su propia semántica de efectos y no equivale al nuevo C11 de email. La auditoría previa detectó riesgo de convertir errores inciertos en failed y habilitar retry. No reutilizar esa ruta para Gmail ni activar otros efectos comerciales sin estudiar/migrar su incertidumbre.

## 8. Configuración y comandos reales

Monorepo npm (`apps/*`, `packages/*`, `pymes`), TypeScript, Node test runner vía tsx, Vite. `engines` exige Node >=22; el entorno probado usaba Node 26.9.0. Comprobar compatibilidad real del runtime seleccionado para distribuir, incluido node:sqlite; no deducir certificación de todas las versiones del rango.

Desde el repo:

```sh
npm ci
npm test
npm run typecheck --workspaces --if-present
npm run build
```

Producto únicamente:

```sh
npm run check --workspace=@agent-world/pymes
npm run demo:pymes
npm run api --workspace=@agent-world/pymes
npm run gmail:build-keychain --workspace=@agent-world/pymes
```

El API necesita configuración de sesión autorizada. No introducir tokens de producción en archivos entregados, prompts ni ejemplos.

Defaults del servicio:

- Vite de desarrollo: `127.0.0.1:5174`, strictPort. Si está ocupado, usar un puerto distinto explícito; no matar procesos ajenos.
- API: `127.0.0.1:8790`.
- SQLite de workspace: `./data/pymes-workspace.db`.
- SQLite del task runtime: `./data/pymes-task-runtime.db`.
- Ledger Gmail: ruta del runtime + `.gmail-attempts.db`.
- Helper compilado desde el workspace PYMES: `pymes/data/bin/gmail-keychain`.
- Rutas relativas de datos se resuelven según cwd real; configurar rutas absolutas para el appliance.
- UI conectada: URL de Vite con `?workspaceApi=http%3A%2F%2F127.0.0.1%3A8790&tenant=<tenant>` y sesión introducida desde Configuración.

Variables no secretas del piloto Gmail:

```text
PYMES_GMAIL_ENABLED=1
PYMES_API_HOST=127.0.0.1
PYMES_FAKE_EMAIL_ENABLED=0
PYMES_GMAIL_KEYCHAIN_HELPER=<ruta absoluta del ejecutable>
PYMES_GMAIL_DESKTOP_CLIENT_PATH=<ruta real del JSON OAuth Desktop>
PYMES_API_BOOTSTRAP_TENANT=<tenant de piloto>
PYMES_API_BOOTSTRAP_USER=<propietario de piloto>
PYMES_API_DB_PATH=<ruta absoluta del workspace SQLite>
PYMES_RUNTIME_DB_PATH=<ruta absoluta del runtime SQLite>
```

`PYMES_API_BOOTSTRAP_TOKEN` es secreto de sesión del producto: usar el mecanismo local autorizado, nunca incluirlo en una entrega `.md`. Los secrets Google no van en env: se importa un archivo existente y se guardan en Keychain. El JSON original descargado también contiene secretos; gestionarlo de forma segura y no versionarlo.

Inferencia: `LLAMA_BASE_URL` loopback, `LLAMA_MODEL`, `LLAMA_API_KEY` opcional según servidor. No enviar la clave al modelo. Sin servidor disponible el plan falla explícitamente; no simular conexión para ocultarlo.

No asumir que siguen vivos los servidores temporales QA ni que sus puertos son configuración del producto. El QA Gmail temporal se cerró; las capturas usan una cuenta sintética `owner@example.test`.

## 9. Verificación y commits

Última suite completa ejecutada en la entrega M3:

```text
715 tests totales
714 pasan
0 fallan
1 omitido: integración opcional Orca
19 nuevos tests de Gmail pasan
typecheck de workspaces: correcto
build de workspaces: correcto
```

En este traspaso documental no se volvió a ejecutar la suite: son resultados registrados del código M3, no una nueva aceptación real.

Además:

- Helper Swift compilado; escritura/lectura/borrado de un registro Keychain sintético comprobados.
- Tests de OAuth éxito/cancelación/state/caducidad, refresh/revocación y desconexión frente a respuestas tardías.
- 401/403/429/5xx, timeout, respuesta perdida, scope solo envío y evidencia ausente/ambigua.
- SIGKILL real de proceso contra servidor HTTP Gmail sintético independiente; journal restaura UNKNOWN y GET reconcilia con un único POST.
- QA de navegador: draft → review exacta → aprobación → C11 → evidencia, estado de cuenta/scopes/comprobación/desconexión.
- No se ha confirmado OAuth real, correo real recibido ni prueba C contra Google.

Commits relevantes:

| Commit | Contenido |
| --- | --- |
| `3699149` | Conservación del baseline AW2 previo. |
| `1b43375` | Contrato de email, aprobación durable y adapter C11 Fake. |
| `3c60937` | Integración M1/M2 con API/UI del producto. |
| `32c9a11` | OAuth local, Keychain y Gmail adapter durable, tests. |
| `325e6fd` | Configuración Gmail y review exacta en UI. |
| `dfa636b` | Protocolo A/B/C contra Gmail. |
| `8694a64` | Autorización de cuenta dedicada y opción futura metadata. |

La rama estaba limpia al preparar este documento. Su propio commit documental será posterior a `8694a64`; pedir SHA actual antes de aplicar código y contrastar los hashes de archivos afectados.

Capturas locales:

- `/Users/mac/Downloads/AUTONOMO_OS_M2_EMAIL.png`
- `/Users/mac/Downloads/AUTONOMO_OS_M2_RECONCILIATION.png`
- `/Users/mac/Downloads/AUTONOMO_OS_M3_GMAIL_QA.png` — sintético, no prueba de cuenta Google real.

## 10. Pendiente inmediato: aceptación M3 real

El propietario autorizó `gmail.send` + `gmail.readonly` en una cuenta Gmail dedicada de pruebas, además de los scopes de identidad `openid`/`email` usados para imponer From. Esta autorización ya está dada; no pedirla de nuevo para la misma cuenta dedicada y finalidad.

Faltan dos datos reales:

1. Ruta local al JSON OAuth Desktop.
2. Email destinatario que controla el propietario, preferiblemente otra cuenta.

Los mensajes anteriores contienen marcadores de posición. El ejemplo `autonomo.os.test@gmail.com` no es una cuenta confirmada ni un destinatario autorizado. No inventar, buscar o enviar a ese ejemplo.

Sin esos datos no se puede cerrar M3. El programador puede entregar preparación/test harness, pero no afirmar que ejecutó OAuth o envió correo real.

### A — Envío real normal

Conectar desde nuestra UI, verificar identidad/scopes, crear trabajo y contenido inocuo único, aprobar destinatario/texto exactos, ejecutar por C11, observar y confirmar una recepción real única en segunda cuenta. Registrar referencias no secretas del job/review/effect/observation y resultado.

### B — Reinicio real

Cerrar la API del piloto de forma normal, arrancarla con las mismas DB/tenant/owner, comprobar conexión conservada desde Keychain e historial, hacer un nuevo trabajo/aprobación/envío y confirmar recepción.

### C — Aceptación real + pérdida de respuesta local

Gmail acepta MIME → el transporte de pruebas descarta respuesta antes de entregarla al adaptador → efecto UNKNOWN → SIGKILL → restart con misma base → reconcile busca evidencia real → comprueba Message-ID/contenido/SENT → no POST adicional → una única recepción y resultado efectivo reconciliado.

La prueba equivalente sintética ya pasa, pero la decisión vigente exige C contra Google real. Mantener el UNKNOWN histórico; committed efectivo vía C7 es correcto.

### Evidencias mínimas

- Referencias de cuenta/tenant de prueba, versión de código y fecha.
- Referencias task/review/binding/effect/observation/reconciliation; sin credenciales.
- Confirmación de recepción única A/B/C por destinatario.
- Historial conservado tras restart y contador de POST del transporte de pruebas.
- Inspección de secretos que informe solo coincidencias/sí-no, nunca imprima tokens ni el JSON OAuth.
- Documentación, suite completa, typecheck, build y número final de tests.
- Commit de cierre solo después de estas evidencias. Comunicar resultado al propietario antes de iniciar M4.

Google External/Testing puede emitir refresh tokens que expiran a los siete días si hay scopes Gmail. La prueba B demuestra persistencia entre reinicios, no autorización ilimitada. La verificación OAuth para distribución pública sigue pendiente.

## 11. Primera orden de programación — entrega P01

**P01: preparar fault-injection aislada para C contra Google real. No empezar Inbox/CRM.**

Antes de modificar, inspeccionar `GmailEmailProvider`, `GmailLocalConnector`, el fetcher inyectable, server/runtime wiring y la prueba SIGKILL actual. Si ya hay un harness equivalente utilizable con Gmail real, identificarlo y entregar instrucciones reproducibles; evitar duplicarlo.

### Resultado requerido

Una herramienta/harness exclusivo del piloto que permita ejecutar el envío aprobado mediante la misma cadena de UI/API/runner y simular pérdida de respuesta después de aceptación real.

Requisitos:

1. Usar el seam de transporte inyectable. No añadir un nuevo sender ni sustituir C11.
2. Interceptar solo el endpoint exacto `messages.send` y el intento/effect de prueba seleccionado explícitamente. No alterar OAuth, refresh, lecturas ni otros mensajes.
3. Consumir la respuesta satisfactoria real y descartar su entrega al adaptador antes de persistir un recibo de éxito; propagar incertidumbre. Si no hay aceptación confirmada, informar que la inyección no se activó: no inventar aceptación.
4. Activación explícita, de un solo uso y aislada del servicio normal de A/B. No dejar una variable global que cause fallos inadvertidos en un producto instalado.
5. Registrar solo metadata permitida/contadores. Nada de Authorization, tokens, JSON OAuth o bodies completos en logs del harness.
6. Exponer suficiente señal para matar **solo el proceso del piloto** con SIGKILL después de que UNKNOWN sea durable, reiniciar con misma DB y reconciliar.
7. No iniciar segundo POST al reiniciar/reconciliar. Cuenta y generación de conexión coherentes; no cambiar el binding de aprobación para sortear la validación.
8. Tests sin cuentas reales que prueben selección, un solo uso, respuesta no exitosa, cancelación, persistencia y un solo POST después de SIGKILL/reinicio/reconciliación.
9. Documentar cómo preparar A/B/C y qué debe hacer el propietario en consentimiento/recepción. La ausencia de credenciales no es un fallo de arquitectura.
10. No modificar las máquinas de estados C1–C12 ni rebajar el criterio de observación exacta para facilitar la prueba.

### Criterios de revisión de P01

- El cambio tiene una única entrada de envío: `GmailEmailProvider` llamado por C11.
- El fallo ocurre después de aceptación y antes de que el adaptador entregue éxito; el usuario puede distinguirlo de una respuesta nunca recibida.
- Reutiliza journal/ledger/Keychain y el sistema de approvals existente.
- No habilita fault-injection indiscriminada en producción ni otros tenants.
- Tests significativos, comandos reproducibles y límites explícitos.
- Si no se ejecutaron pruebas reales, se declaran PENDIENTES.

Entrega esperada: `ENTREGA_P01_GMAIL_PRUEBA_C.md` con el formato de la sección 13. Esta especificación autoriza preparar código de piloto, no envíos a destinatarios inventados ni acceso al Gmail personal principal.

## 12. Qué falta por programar después, por orden

Las siguientes son propuestas de entregas: **no están autorizadas para empezar antes del cierre M3 comunicado al propietario**. Codex concretará cada orden tras revisar la entrega anterior.

| Orden | Entrega | Contenido y aceptación |
| --- | --- | --- |
| P02 / M4.1 | Gmail Inbox durable | Servicio de lectura separado, full sync, mensajes deduplicados por cuenta/tenant/id, cursor historyId, incremental, paginación y fallback 404; restart sin pérdida/duplicado. |
| P03 / M4.2 | CRM local mínimo | Contacto, identidad, lead, interacción y seguimiento reales en SQLite; índices, ownership y historial. Migraciones/versiones y enlaces al mensaje. Identidad ambigua va a revisión. |
| P04 / M4.3 | Clasificación/resumen local | Mensajes reales con contexto mínimo → resumen/intención/ramo/prioridad; outputs validados, procedencia y benchmark. Contenido entrante no cambia políticas. |
| P05 / M4.4 | Workflow real integrado | Sustituir fixtures progresivamente: mensaje → contacto → resumen → borrador → revisión → C11 → evidencia → interacción/seguimiento. Cerrar criterios de cada paso con datos reales. |
| P06 | Jornada y UX profesional | Bandeja real, detalle de cliente, búsquedas, seguimientos y estados vacíos/error. Acciones exactas y lenguaje de usuario. Verificación visual de recorridos. |
| P07 | Calendar/otros canales | Google Calendar y WhatsApp Business con autorización, efectos observados y recuperación. Telegram/iMessage solo tras resolver APIs/permisos soportados; no simular conexiones. |
| P08 | Appliance comercial | Instalación/arranque/reinicio/actualización firmada cuando proceda, backup+restore integral, autenticación local profesional, diagnósticos y benchmark del equipo real. |

### M4 — arquitectura prevista

Full sync inicial → ingestión durable/deduplicada → cursor historyId confirmado → history.list incremental → si 404, full sync. No avanzar el cursor antes de que los mensajes de esa página estén persistidos. Cuenta nueva implica namespace/cursor nuevo.

Lectura de inbox no concede capacidad de envío. Los datos CRM y decisiones deben tener procedencia; una salida del LLM no es una póliza, una cotización ni una verificación de identidad.

Operaciones CRM deberán tener idempotencia/registro y criterio de aceptación propios; no bastará con cambiar la etiqueta de los artefactos simulados actuales.

### Deuda transversal para un producto vendible

- Auth/onboarding/sesiones locales/expiración y permisos operativos, más allá del bootstrap de piloto.
- Backups consistentes de workspace/runtime/ledger, restauración y relación con Keychain: no restaurar una DB como si incluyera los tokens.
- Multiinstancia y concurrencia documentadas antes de permitirse; SQLite local y un proceso autoritativo en el piloto.
- Diagnóstico, actualización, rollback y entrega en un Mac limpio con paths estables.
- Modelo local seleccionado mediante benchmark en 24 GB; latencia, memoria, calidad, tolerancia a fallos y consumo con apps reales.
- Datos demo diferenciados de reales en todas las pantallas; ninguna cifra ficticia como KPI del cliente.
- Licencias/dependencias, distribución OAuth de Google y configuración del appliance como tareas específicas antes de vender.
- Scheduler general, multi-provider AW2 y learning router evaluado/desactivado por defecto; no indispensables para introducir un sender paralelo.
- Propuestas de seguros integradas con sistemas autorizados; no automatizar decisiones de cobertura ni presentar ofertas inventadas.

### Mejora futura metadata — no implementar en P01

Estudiar `gmail.metadata` + messages.list(labelIds=SENT) paginado + messages.get(format=METADATA, metadataHeaders=[Message-ID]) + comparación del marcador. No se puede usar q con metadata.

Un listado acotado puede no encontrar el mensaje; ausencia debe conservar UNKNOWN. La cabecera sola no prueba cuerpo aprobado. Cualquier futura sustitución requiere definir qué evidencia satisface el contrato, sin degradar silenciosamente la comprobación actual. Para leer y resumir contenido en M4 hará falta un scope adecuado de lectura.

## 13. Formato obligatorio de entregas del programador en .md

Un archivo por entrega, no por conversación. Para entregas grandes se admiten varios `.md` numerados con un manifiesto principal.

### Cabecera

```text
Entrega: P01
Nombre: Gmail fault-injection para piloto real
Base: SHA completo comprobado del repositorio
Estado: propuesta / implementado / probado
Acceso al repo: sí / no
Pruebas ejecutadas realmente: ...
Pruebas no ejecutadas: ... y motivo
```

### Resumen y manifiesto

Indicar qué cambia, por qué, dependencias añadidas y cada archivo a crear/modificar/eliminar. Para cada modificación: ruta relativa al repo, SHA-256 del archivo de base si se tuvo acceso y estrategia (contenido completo o diff). No mezclar cambios de refactor ajenos.

No entregar rutas con `../`, rutas a carpetas ajenas ni un reemplazo masivo del repo. Las eliminaciones/migraciones requieren justificación concreta y conservar datos.

### Código

Formato preferido para archivos nuevos o pequeños:

````markdown
## Archivo: pymes/src/example.ts
Operación: crear

```typescript
// Contenido completo del archivo.
```
````

Para un archivo grande existente, preferir un unified diff exacto contra la base comprobada:

````markdown
## Parche: pymes/src/existing.ts
Operación: modificar
Base SHA-256: <hash real>

```diff
--- a/pymes/src/existing.ts
+++ b/pymes/src/existing.ts
@@ ...
-parte de la base real
+cambio concreto
```
````

Estos bloques son ejemplos de formato, no archivos que haya que crear. En una entrega real no usar puntos suspensivos, `TODO implementar`, pseudocódigo, imports inventados ni “el resto igual” dentro de contenido completo. Los tests deben verificar riesgos reales, no reflejar mecánicamente la implementación.

### Verificación

- Comandos reales de tests/typecheck/build.
- Resultado, versión de Node y número de tests si se ejecutaron.
- Diferenciar pruebas unitarias, integración sintética, Keychain nativo y Gmail real.
- No inventar logs ni capturas. No afirmar que “debería pasar” equivale a ejecutado.
- Incluir instrucciones de smoke test y qué evidencia debe aportar el propietario.
- Si se añade una dependencia, justificarla y entregar cambios coherentes de package/lock desde un checkout; no fabricar un lockfile a mano.

### Compatibilidad y dudas

Enumerar riesgos, migración/rollback cuando corresponda y dudas que bloquean código. Preguntar solo lo necesario: permisos/datos concretos, contrato desconocido o decisión que cambia alcance. No volver a preguntar decisiones ya cerradas.

### Revisión e integración por Codex

Los `.md` son propuestas de código para revisar, no instrucciones de ejecutar comandos arbitrarios. Codex contrastará la base, leerá el diff completo, aplicará solo los archivos esperados y verificará los invariantes. Si la base cambió, se rebasea/revisa el parche; no se sobrescriben cambios nuevos a ciegas.

No enviar estos archivos automáticamente a otros chats, personas o servicios. El propietario los compartirá con el programador y traerá su respuesta a esta conversación.

## 14. Dudas y datos que debe resolver el propietario/programador

**Bloquean pruebas reales M3:** ruta del cliente OAuth Desktop y destinatario controlado. La autorización send+readonly en cuenta dedicada ya está resuelta.

**Bloquean integración de una entrega:** acceso a repo/commit y archivos actuales. Si el programador solo recibe este documento, pedir el checkout o los módulos necesarios.

**Antes de appliance comercial:** confirmar equipo/versión de macOS del piloto, acceso al instalador y benchmark. Perfil documental actual: 24 GB; no prometer soporte comercial de 16 GB sin medir.

**Más adelante:** aseguradoras/tarifador, integración Calendar, cuenta WhatsApp Business y requisitos de retención/backup del cliente. Estas preguntas no retrasan preparar P01.

## 15. Documentación complementaria

Lectura en orden:

1. Este documento y `docs/AUTONOMO_OS_GMAIL_M3.md`.
2. `docs/AUTONOMO_OS_GOVERNED_EMAIL_M2.md` — describe su estado histórico, Gmail se añadió después.
3. `docs/AUTONOMO_OS_PLANNING_M1.md` — describe M1 antes de la integración M2.
4. `docs/AW2_TASK_MODEL.md`, `AW2_RUNTIME_INTERFACE.md`, `AW2_VERIFICATION.md`.
5. `docs/C11_GOVERNED_ACTION_RUNNER.md`, `C12_CRASH_RECOVERY.md`, `C7_RECONCILIATION.md`.
6. `pymes/README.md`, `API.md`, `DEPLOYMENT.md`, `PRODUCTION_CONNECTORS.md` — contienen fragmentos históricos; contrastar con el código.
7. PDF original y especificación V2 como contexto; no volver a reproducir 1.400 páginas como proyecto nuevo.

El handoff anterior y la auditoría del 3 de octubre conservan datos como árbol sin commit, email no implementado o 660/695 pruebas. El código está ahora versionado y M3 implementado; esos textos no sustituyen este snapshot actualizado.

## 16. Mensaje listo para enviar al programador

> Continúa el repositorio Agent World OS / Autónomo OS existente a partir del snapshot y los contratos de este documento. Primero inspecciona los módulos reales y devuelve la entrega P01: preparación de fault-injection aislada para validar M3 Gmail contra Google sin saltarse C11, approvals, Keychain ni UNKNOWN/reconciliación. No empieces M4 ni reconstruyas el proyecto. Entrega el código en `ENTREGA_P01_GMAIL_PRUEBA_C.md`, con manifiesto, base, rutas y bloques completos o unified diffs exactos, tests y resultados realmente ejecutados. Si no tienes el repo, pide los archivos que necesitas antes de escribir sustituciones. Las credenciales y el destinatario reales los aporta el propietario; nunca inventes ni incluyas secretos. Codex revisará e integrará tu entrega y definirá la siguiente.

---

## Anexo A — Protocolo M3 completo vigente

Se incluye a continuación una copia de `docs/AUTONOMO_OS_GMAIL_M3.md` a fecha de este traspaso. Es contexto de aceptación, no prueba de que el piloto real haya pasado.

# M3 — Gmail local con ejecución gobernada

Fecha: 2026-10-04
Repositorio: `/Users/mac/Downloads/agent-world-os`
Base aceptada M2: `3c60937`

## Estado

Implementado el conector Gmail y su integración con el producto. Verificado con transporte HTTP sintético y llavero nativo real con datos sintéticos. **M3 no está cerrado: falta OAuth con una cuenta real y comprobar la llegada de un correo a un destinatario de prueba.** Las pruebas sintéticas no demuestran entrega real.

## Recorrido

Plan → C8/C9 → aprobación durable del payload y versión exactos → Governed Runner C11 → Effect → EmailProvider → Gmail API → observación/reconciliación.

La UI guarda un borrador y solicita revisión, aprobación y ejecución. No contiene tokens de Google ni llama directamente a Gmail. Se conserva FakeEmailProvider para M2/tests. No se modifica la máquina de estados del core. La clasificación de rechazo certificado previo al dispatch se amplía mediante EmailDispatchError.

La aprobación Gmail incorpora el contexto de cuenta y generación de conexión. Cambiar la cuenta o reconectar invalida la aprobación anterior. El contenido se bloquea después de crear su revisión.

## Credenciales y OAuth

- Aplicación Google OAuth de tipo Desktop, navegador del sistema, PKCE S256, state aleatorio y callback en `127.0.0.1` con puerto efímero.
- Callback de un solo uso, validación de estado/host, caducidad de cinco minutos, comprobación de la sesión local al completar.
- Identidad comprobada con userinfo y email_verified. No se usa getProfile bajo gmail.send.
- Tokens, refresh token y client secret en macOS Keychain mediante `pymes/native/keychain.swift`. El helper recibe secretos por stdin y devuelve datos por pipe; nunca usa argumentos con secretos ni plaintext fallback.
- Configuración y credencial usan referencias opacas por tenant/owner. SQLite guarda el contenido aprobado, intentos y evidencia, nunca credenciales Google.
- Refresh sin reintentos automáticos, compartido por llamadas simultáneas. Desconectar invalida respuestas tardías y elimina las credenciales locales. Mantiene configuración del cliente OAuth en Keychain, jobs e historial.
- Desconectar no revoca el permiso remoto en la cuenta Google ni puede retirar un correo ya aceptado. La revocación remota puede hacerse desde la cuenta Google.
- Piloto: un propietario y una cuenta Gmail por proceso/tenant. API Gmail solo en loopback; no combinar Fake y Gmail en el mismo proceso.

## Permisos exactos

| Scope | Motivo |
| --- | --- |
| `https://www.googleapis.com/auth/gmail.send` | Enviar el MIME aprobado. |
| `openid` | Identidad de la cuenta de Google. |
| `email` | Dirección verificada que se muestra y se impone como From. Google puede devolver su alias userinfo.email. |
| `https://www.googleapis.com/auth/gmail.readonly` | Opcional, desmarcado por defecto: consultar raw en Enviados y buscar Message-ID para reconciliar. |

**gmail.readonly permite leer toda la cuenta**, aunque este adaptador solo consulta Enviados. Su consentimiento debe ser explícito. No se pide `https://mail.google.com/`. gmail.metadata no permite buscar con q ni verificar el cuerpo; no satisface esta prueba de contenido exacto.

Sin gmail.readonly no hay consulta independiente: una respuesta 200 del envío aporta un recibo, pero el efecto sigue UNKNOWN sin observación comprobada. No equivale a un envío fallido y no se debe repetir.

Referencias oficiales: [OAuth desktop](https://developers.google.com/identity/protocols/oauth2/native-app), [scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [búsqueda messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

## MIME y evidencia

Inicialmente: un To, From de la cuenta conectada, Subject UTF-8 y cuerpo text/plain UTF-8. CC/BCC siguen en el contrato pero M3 los rechaza. Sin HTML ni adjuntos. La codificación base64 preserva los bytes del cuerpo aprobado y sus saltos de línea.

- Message-ID determinista: `<awos.<effect-key>@autonomo-os.invalid>`.
- Cabecera `X-AWOS-Payload-SHA256` del payload aprobado.
- Antes del POST se registra un claim SQLite durable WAL/FULL con clave única.
- Un claim existente prohíbe otro POST con esa clave, incluso tras reinicio.
- El claim no acredita envío. Un crash en el hueco claim→HTTP queda incierto aunque todavía no hubiera llamada.
- Consulta primero el Gmail id conocido; si no hay prueba, busca `in:sent rfc822msgid:<marker>`.
- Exige label SENT y coincidencia de Message-ID, hash, From, To, Subject, tipo MIME y cuerpo exacto. Sin coincidencia o con búsqueda ambigua queda UNKNOWN.
- Reconciliación hace GET solamente. No reenvía ni convierte una ausencia de resultados en prueba de no envío.
- Gmail no proporciona aquí una garantía de idempotencia nativa. La marca es correlación propia; si Gmail transforma el MIME o sustituye cabeceras relevantes, la verificación conservadora puede quedarse UNKNOWN.
- Ver Enviados prueba aceptación registrada por Gmail, **no recepción en el buzón del destinatario**, ausencia de rebote o lectura. La entrega real de la prueba requiere comprobarla aparte.
- Desconectar impide nuevos dispatch. Una petición ya en curso puede ser aceptada antes de la desconexión; conserva su incertidumbre y su evidencia.

## Instalación para prueba real

1. En Google Cloud, habilitar Gmail API, configurar consentimiento y usuario de prueba cuando corresponda, crear un cliente OAuth **Desktop**. Descargar su JSON a una ruta local protegida. No pegar secretos en chat ni añadir el JSON al repositorio.
2. Desde la raíz:

```sh
npm run gmail:build-keychain --workspace=@agent-world/pymes
```

3. Configurar el servicio local con rutas (sin secretos en argumentos/env):

```text
PYMES_GMAIL_ENABLED=1
PYMES_API_HOST=127.0.0.1
PYMES_GMAIL_KEYCHAIN_HELPER=/Users/mac/Downloads/agent-world-os/pymes/data/bin/gmail-keychain
PYMES_GMAIL_DESKTOP_CLIENT_PATH=<ruta local al JSON Desktop>
PYMES_FAKE_EMAIL_ENABLED=0
```

Las variables de sesión, tenant, DB y modelo siguen las instrucciones M1/M2. Usar un tenant de piloto y una base de datos nueva evita mezclar trabajos de simulación con nuevos Gmail. El backend importa el cliente al llavero; no copia el JSON. El original descargado contiene secretos: debe gestionarlo el propietario/instalador de forma segura. Tras importar, puede quitarse la variable de ruta; la configuración permanece en Keychain.

4. Abrir Configuración y conectar el workspace. Conectar Gmail abre el navegador del sistema. El propietario completa el consentimiento. Para cierre verificado de M3, autorizar lectura opcional en la cuenta de prueba.
5. Crear y planificar un trabajo. Guardar destinatario/asunto/texto de prueba, evaluar, revisar exactamente el contenido, aprobar y ejecutar.
6. Comprobar evidencia en el runtime y llegada real en el destinatario. No repetir un efecto UNKNOWN. Consultar/reconciliar si hay permiso de lectura.
7. Reiniciar la API, comprobar persistencia; desconectar, comprobar que no hay nuevas ejecuciones y se conserva la historia.

El ejecutable del llavero debe mantenerse estable durante la instalación. Su compilación requiere las herramientas de desarrollo de Apple. La firma, distribución y actualización del appliance comercial quedan fuera de esta prueba M3.

## Interfaz

Configuración: desconectado/conectando/conectado/error, cuenta, permisos, última comprobación, comprobar y desconectar. Sin tokens. Centro de agentes: borrador editable antes de revisar, payload exacto, aprobación, runner, efectos y evidencia.

La preparación del lead y las operaciones CRM siguen siendo fixtures locales; no se acredita un CRM real ni lectura del inbox. Los registros históricos M2 conservan su identificación de simulación. La prueba visual usa un transporte sintético indicado en el nombre del trabajo, no una cuenta de Gmail real.

## Inbox posterior

Servicio separado de sincronización, sin autoridad de envío: full sync inicial → guardar cursor historyId por cuenta/tenant → history.list incremental → si 404 por cursor obsoleto, full sync de nuevo. Persistir cursor solo después de ingestión durable/deduplicada; páginas intermedias no adelantan el checkpoint. Cambiar cuenta invalida el cursor. El GmailEmailProvider de M3 se mantiene como adaptador de effects; no se ha implementado este servicio de inbox.

Referencia: [guía oficial de sincronización](https://developers.google.com/workspace/gmail/api/guides/sync).

## Verificación y pendiente

Resultado: 715 tests totales, 714 pasan, 0 fallan, 1 test opcional Orca omitido. Los 19 nuevos tests Gmail pasan. Typecheck y build de todos los workspaces correctos. Llavero nativo: escritura, lectura y borrado de un registro sintético verificados. QA en navegador: borrador, revisión, aprobación, runner, evidencia y controles de cuenta/permisos.

Tests cubren MIME UTF-8/saltos de línea/tampering, OAuth cancelado/éxito/estado incorrecto/caducidad, refresh/credencial revocada, respuestas tardías tras desconectar, 401/403/429/5xx, timeout, respuesta perdida, ausencia/ambigüedad, scope solo envío, reinicio y SIGKILL real de un proceso contra un servidor Gmail sintético independiente.

SIGKILL: el servidor de prueba acepta MIME, retiene la respuesta; se mata el proceso; C12 restaura UNKNOWN; GET verifica el MIME; C7 proyecta committed sin reescribir el UNKNOWN histórico ni hacer otro POST.

Pendiente para cerrar M3: ruta al JSON Desktop, cuenta de prueba, consentimiento para gmail.readonly si se quiere reconciliación automática comprobable, destinatario y entrega real. No se ha lanzado consentimiento real ni enviado correo real.


## Protocolo de cierre A/B/C acordado

No crear tag de cierre ni iniciar M4 hasta completar las validaciones reales pendientes.

### Preparación de Google

Usar proyecto con Gmail API habilitada y OAuth Desktop. Para una cuenta Gmail personal, configurar audiencia External/Testing y añadir explícitamente el remitente como usuario de prueba. Registrar en Data Access gmail.send y los permisos de identidad; si se autoriza la comprobación independiente implementada, añadir también gmail.readonly. El permiso solo envío no habilita messages.list/get ni permite cerrar la prueba C con este verificador.

En External/Testing, los refresh tokens de una autorización que incluye Gmail caducan a los siete días. Una prueba B próxima demuestra persistencia entre reinicios, no autorización indefinida. La preparación para producción/verificación OAuth es trabajo posterior de distribución del producto.

Fuentes oficiales: [estado OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [caducidad en Testing](https://developers.google.com/identity/protocols/oauth2), [permisos de messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

### A — Envío normal real

1. Conectar desde Configuración usando el cliente importado al Keychain y completar el consentimiento con la cuenta remitente de prueba.
2. Comprobar cuenta/scopes en UI. No imprimir ni exportar el contenido de los registros de Keychain para demostrar almacenamiento.
3. Crear un trabajo con asunto único `M3-A-<fecha-hora>` y contenido inocuo dirigido a una segunda cuenta confirmada por el propietario.
4. Guardar, evaluar, revisar el destinatario y el texto exactos, aprobar y ejecutar mediante Governed Runner.
5. Registrar taskId, reviewId/bindingHash, effectId, observationIds, Gmail id si está disponible, Message-ID y hora. No incluir Authorization ni tokens en la evidencia.
6. Comprobar en la segunda cuenta que ha llegado exactamente un mensaje con asunto/cuerpo esperados. Verificar separadamente efecto committed y progreso en la UI.

### B — Reinicio real

1. Cerrar de forma normal el proceso API del piloto y volver a arrancar con las mismas rutas DB, tenant y propietario. No borrar datos ni desconectar Gmail.
2. Comprobar que la cuenta reaparece desde Keychain y que se conserva el historial A.
3. Crear un trabajo nuevo con asunto único `M3-B-<fecha-hora>`, obtener una nueva aprobación y efectuar otro envío por el runner.
4. Comprobar recepción única y evidencia independiente. El refresh se comprueba además por tests de expiración; no debe forzarse mostrando/editando tokens reales.

### C — Respuesta perdida, SIGKILL y reconciliación

La prueba equivalente automatizada ya existe en `pymes/tests/gmail-runtime.test.ts`: un servidor HTTP independiente acepta MIME, retiene la respuesta; se mata el proceso del runner con SIGKILL; se restaura el journal y la ledger; se observa UNKNOWN y se reconcilia mediante GET, con un único POST en todo el recorrido.

Para una variante contra Google se debe usar exclusivamente un transporte de fault-injection del piloto, conectado al fetcher inyectable existente: consumir y descartar una respuesta exitosa de messages.send antes de entregarla al adaptador, sin volver a ejecutar el POST. No activar fallos globales en el servicio utilizado para A/B y no cambiar la semántica del core. Todavía no se ha ejecutado esta variante contra Google.

Criterios: conservar aprobación exacta, comprobar UNKNOWN histórico después del fallo/reinicio, consultar el Message-ID ya implementado, verificar MIME exacto y SENT, conservar la decisión de reconciliación y confirmar un único mensaje en el destinatario. C7 puede proyectar resultado efectivo committed mientras C6 conserva UNKNOWN histórico. No es necesario reescribir el efecto original a committed para acreditar reconciliación.

### Registro de aceptación

| Comprobación | Estado actual | Evidencia pendiente |
| --- | --- | --- |
| OAuth Desktop con Google real desde UI | Pendiente | Cuenta/cliente de prueba y consentimiento |
| Keychain nativo | Verificado con datos sintéticos | Credencial real guardada por OAuth, sin exponerla |
| A: entrega real + efecto comprobado | Pendiente | Mensaje recibido y referencias del efecto |
| B: conexión tras reinicio + segundo envío | Pendiente | Capturas/refs del segundo trabajo |
| C: SIGKILL, UNKNOWN, reconciliación sin duplicado | Equivalente sintético verificado | Variante contra Google requerida por la decisión del propietario |
| Ausencia de secretos en auditoría/SQLite/logs reales | Pendiente de sesión real | Inspección que informe solo coincidencias, sin imprimir secretos |
| Suite, tipos y build | Verificados en M3 | Repetir si cambia código durante el piloto |
| Tag de cierre M3 | No creado | Aceptación de las evidencias reales |

La aceptación sintética de C no sustituye OAuth real, llegada del correo real ni persistencia real de B. M4 sigue pendiente del cierre M3.


## Decisión del propietario — 2026-10-04

Autorizados gmail.send + gmail.readonly exclusivamente en una cuenta dedicada de prueba/piloto, junto con los permisos de identidad ya documentados. No usar el Gmail personal principal. No es necesario volver a solicitar esta misma autorización; sigue pendiente conocer la ruta real del JSON Desktop y el destinatario controlado por el propietario. Los marcadores de posición aportados no son datos ejecutables y el ejemplo de cuenta no identifica una cuenta existente ni un destinatario autorizado.

Se exige A/B/C contra Gmail real, incluida pérdida de respuesta local tras aceptación y SIGKILL/restart/reconciliación sin reenvío. La prueba sintética existente acredita el mecanismo, pero no cierra esta aceptación. Después de A/B/C: actualizar evidencias y límites, suite completa, typecheck, build, número final de tests y commit de cierre. Comunicar el resultado antes de iniciar M4.

### Mejora futura de permisos: metadata

Estudiar gmail.metadata → messages.list con labelIds=SENT y paginación limitada → messages.get(format=METADATA, metadataHeaders=[Message-ID]) → comparar identificador estable. Sin q, ya que gmail.metadata no permite ese parámetro. No se implementa ahora.

Límites a estudiar: messages.list no ofrece un filtro temporal equivalente a q bajo metadata; un listado acotado no garantiza encontrar el mensaje ni permite tratar ausencia como no envío. Deben definirse paginación, ventana/cursor y comportamiento UNKNOWN conservador. La coincidencia de Message-ID en metadata tampoco comprueba el cuerpo aprobado, a diferencia del verificador raw actual; antes de sustituirlo habría que definir qué evidencia satisface el contrato de observación. Para M4 la lectura del contenido seguirá necesitando un permiso adecuado.
