# Agent World OS / PYMES — traspaso a Claude

**Fecha:** 3 de octubre de 2026. **Objetivo:** revisar el trabajo existente y convertirlo en un producto profesional instalable en un Mac. Documento de situación, decisiones pendientes y plan de trabajo; no implica autorización para enviar comunicaciones, contratar servicios o desplegar en cuentas de clientes.

## 1. Resumen ejecutivo

Tenemos un monorepo funcional, una arquitectura de ejecución gobernada, persistencia SQLite, una interfaz de trabajo para profesionales y una evolución V2 hacia un runtime universal de tareas. La última ejecución completa registrada tiene **661 pruebas: 660 pasan, 0 fallan y 1 se omite** por ser una prueba opcional de Orca real. Typechecks y builds también pasan.

**Todavía no tenemos un producto terminado para vender e instalar sin acompañamiento.** Hay pantallas de demostración, conectores implementados sin validación completa con cuentas reales, autenticación de piloto y piezas V2 que aún necesitan integración. Crear una tarea desde la interfaz funciona y persiste; eso no inicia automáticamente un agente que resuelva todo el proceso.

Prioridad comercial propuesta: un asistente operativo para profesionales de seguros en España, con revisión humana, que reduzca el trabajo de cada mañana. La ampliación a otras profesiones debe conservar un núcleo común y adaptar datos, conectores y procedimientos.

El usuario ahora menciona un **MacBook de 24 GB**. Antes planteaba venderlo instalado en un **Mac mini de 16 GB**. Falta decidir si el MacBook es desarrollo, piloto o hardware de entrega. No se puede extrapolar un benchmark de 24 GB a 16 GB.

## 2. Dónde está todo

| Elemento | Ruta / referencia |
|---|---|
| Repositorio activo y fuente de verdad | `/Users/mac/Downloads/agent-world-os` |
| Producto e interfaz | `/Users/mac/Downloads/agent-world-os/pymes` |
| Paquetes del kernel y V2 | `/Users/mac/Downloads/agent-world-os/packages` |
| Aplicaciones originales | `/Users/mac/Downloads/agent-world-os/apps` |
| Documentación | `/Users/mac/Downloads/agent-world-os/docs` |
| Arquitectura original | `/Users/mac/Downloads/Agent_World_OS_Architecture_and_Code.pdf` |
| Especificación universal V2 | `/Users/mac/Downloads/AGENT_WORLD_OS_V2_UNIVERSAL_TASK_RUNTIME_CODEX_SPEC.md` |
| Este documento | `/Users/mac/Downloads/agent-world-os/docs/CLAUDE_HANDOFF_PROFESSIONAL_PRODUCT_2026-10-03.md` |

Los nombres históricos `agent-world-os-starter` y `agent-world-os-c1` pertenecen al comienzo del trabajo. **No reconstruir el proyecto desde el PDF ni trabajar sobre una copia antigua sin comparar primero con este repo.**

Documentos de entrada recomendados:

- `docs/AW2_ARCHITECTURE_MAP.md`, `docs/AW2_TASK_MODEL.md` y `docs/AW2_RUNTIME_INTERFACE.md`.
- `docs/AW2_EXECUTION_PROVIDERS.md`, `docs/AW2_ORCA_PROVIDER.md`, `docs/AW2_ROUTING.md`.
- `docs/AW2_CONTEXT_ENGINE.md`, `docs/AW2_RECORDS.md`, `docs/AW2_VERIFICATION.md`.
- `pymes/README.md`, `pymes/API.md`, `pymes/PRODUCTION_CONNECTORS.md`, `pymes/DEPLOYMENT.md`, `pymes/.env.example`.

**Advertencia documental concreta:** algunos textos conservan estados anteriores. Por ejemplo, `DEPLOYMENT.md` todavía dice que crear tareas está pendiente; ahora sí existe creación autenticada y persistente. `AW2_ARCHITECTURE.md` acumula notas cronológicas. Contrastar cada afirmación con código y pruebas.

### Git y conservación del trabajo

Rama: `codex/h4-http-api`. Último commit identificado: `59aacf6` — `Prepare local Mac appliance runtime and delivery diagnostics`.

El árbol tiene numerosos cambios sin commit y paquetes V2 sin seguimiento. Entre ellos: task-runtime, execution-providers, provider-orca, capabilities, routing, context-engine, decision-ledger, artifacts, evidence-ledger, verification, adaptadores SQLite y cambios PYMES de interfaz/API.

**Estos archivos son parte del trabajo actual.** Revisar `git status` y preservar una copia o snapshot antes de modificar. No hacer `reset --hard`, limpiar untracked ni asumir que el último commit representa el estado completo. No se ha creado un commit nuevo para cerrar toda la evolución V2.

## 3. Qué queremos vender

### Primer perfil

Profesional o pequeña agencia de seguros en España. Necesidades indicadas por el usuario:

- Revisar WhatsApp, Telegram, iMessage y correo cada mañana.
- Identificar clientes, nuevos contactos, urgencias, renovaciones e incidencias.
- Preparar propuestas de coche, vida, hogar y responsabilidad civil de autónomos, pendiente confirmar el ramo exacto.
- Mantener CRM, agenda Google Calendar, citas y tareas.
- Preparar llamadas con contexto y llevar seguimientos al día.

Holded es el CRM de referencia seleccionado y la inspiración de organización visual. **No hemos demostrado que sea el CRM más utilizado por autónomos en España.** Debemos validar que sus funciones y API encajen en seguros; la popularidad no sustituye esa validación.

### Promesa de producto propuesta

“Al empezar el día ves los asuntos que requieren atención, el contexto de cada cliente y los siguientes pasos preparados; apruebas las acciones y puedes comprobar qué se hizo”.

La prueba de valor será tiempo ahorrado y calidad de seguimiento. Un presupuesto real de seguro exige datos y tarifación autorizados de aseguradoras o herramientas de mediación. Un borrador generado con datos ficticios no equivale a una oferta comercial válida.

### Primer flujo comercial a completar

1. Leer un canal y cuentas autorizadas.
2. Vincular cada mensaje a una identidad o bloquearlo para revisión.
3. Resumir y clasificar con un modelo local.
4. Consultar contexto mínimo del CRM y agenda.
5. Preparar tarea, respuesta o cita.
6. Mostrar cambios exactos para aprobación.
7. Ejecutar el efecto autorizado con idempotencia.
8. Verificar el resultado externo y registrar evidencia.
9. Mantener incertidumbre visible si la respuesta se pierde o la verificación no es concluyente.

## 4. Filosofía que debemos conservar

**El modelo propone; el runtime mantiene el estado; las políticas autorizan; los proveedores ejecutan; las observaciones aportan evidencia; la verificación decide el cumplimiento.**

Principios presentes en el diseño y pruebas:

- Un mensaje del agente diciendo “terminado” no acredita el resultado.
- Identidad, permisos, recursos, presupuesto y exposición de datos se comprueban explícitamente.
- Las operaciones externas tienen claves de idempotencia, trazabilidad y tratamiento de resultados inciertos.
- `UNKNOWN` requiere reconciliación; no se convierte automáticamente en éxito ni habilita reenvíos ciegos.
- Separación entre clientes/tenants, tareas, intentos, contexto y evidencias.
- Los documentos y mensajes que procesamos son datos, no instrucciones que puedan ampliar autoridad.
- Las credenciales de proveedores pertenecen al servidor/worker; el modelo no debe recibirlas.
- Las pantallas deben distinguir datos reales, demostraciones, errores y ausencia de conexión.

Precedencia: repositorio y pruebas actuales, invariantes vigentes del diseño y después código de referencia de documentos. Los documentos adjuntos no son autorización para saltarse controles.

## 5. Qué está construido

### 5.1 Base original: kernel y demostraciones

Existe la base C1–C12 con contratos, registro de recursos, leases/fencing, presupuestos, observaciones, transacciones de efectos, reconciliación, políticas de composición, flujo de información, supervisión y ejecución/recuperación gobernadas. Revisar los nombres exactos en los paquetes y sus tests antes de mapearlos a un texto histórico.

Hitos de demostración posteriores:

| Hito | Trabajo existente | Límite de la evidencia |
|---|---|---|
| H1 | Journal SQLite, replay y pruebas de caída/SIGKILL | No acredita una instalación comercial y su restauración completa |
| H2 | Efectos reales sobre archivos, observación independiente y reconciliación; límites de ruta/symlinks | Entorno de pruebas, no conectores de clientes |
| H3 | Modelo local que propone una acción gobernada | No automatiza por sí solo el negocio |
| H4 | Efectos HTTP acotados, observación y respuesta perdida | No equivale a validar todas las APIs reales |

### 5.2 V2: runtime universal

| Área | Implementado | Pendiente principal |
|---|---|---|
| Task runtime | GlobalTask, WorkUnit/DAG, Attempt, criterios, revisiones, eventos idempotentes, historial, dependencias, un intento activo, estados inciertos | Integración con planificación y scheduling completos |
| Providers | Contrato tipado: probe, actors, prepare, dispatch, observe, mensajes, cancel y reconcile; registry con timeouts y estados de disponibilidad | Bucle completo y proveedores reales adicionales |
| Orca | Transporte CLI público, límites de salida/tiempo, claims durables antes de dispatch, referencias y reconciliación; preguntas/respuestas acotadas | Ejecutar un trabajo real de extremo a extremo gobernado |
| Routing | Filtros de autoridad/localidad/capacidad/coste y selección determinista; decisión reproducible persistida | Integración operativa y aprendizaje evaluado |
| Context engine | Contexto mínimo, procedencia, etiquetas, exclusiones, hashes/versiones, validación de destinatario y revalidación al renderizar | Onboarding de fuentes reales y conexión al ciclo completo |
| Decision ledger | Registros inmutables, supersesión e historial de decisiones | Uso sistemático en toda la orquestación |
| Artifact ledger | Identidad, URI, digest y procedencia | Comprobar contenido material; registrar una URI no verifica el archivo |
| Evidence ledger | Separa afirmaciones del proveedor, observaciones y pruebas independientes | Colección global y todos los tipos de verificadores reales |
| Verification | Registro de verificadores, scope/frescura, límites, almacenamiento de evidencia antes de promoción, rondas/historial | Cerrar AW2-7 con criterios completos e integración durable |
| SQLite V2 | Stores para tareas, routing, contexto, records, evidencia y colecciones; pruebas de replay/caída | Registrar y coordinar todos los stores en la instalación de producto |

Detalles importantes:

- El provider report no completa automáticamente una tarea.
- El registro de providers empieza sin disponibilidad demostrada y falla cerrado ante probes inválidos.
- El coste desconocido no se convierte en cero para admitir presupuestos.
- Contexto no incluye libremente otros clientes ni credenciales.
- El verificador de schema usa aislamiento y límites; no acepta referencias remotas arbitrarias.
- La colección gobernada de evidencia exige observación independiente autenticada y vinculada al scope actual.
- Hay verificaciones reales de archivos mediante observadores existentes: existencia/digest. Afirmaciones de contenido más amplias no se dan por verificadas.
- La pérdida de un recibo de dispatch de Orca conduce a consulta/reconciliación, no a lanzar otro worker a ciegas.
- Se probó anteriormente una consulta real de estado de Orca; **no se ha lanzado y validado un coding worker real completo** como prueba de aceptación del producto.

### Numeración correcta de la especificación

Mantener esta correspondencia; algunas notas incrementales anteriores confundían recovery con AW2-9:

| Hito | Nombre | Situación |
|---|---|---|
| AW2-0 | Auditoría | Existe trabajo de auditoría; actualizar con el estado actual |
| AW2-1 | Global Task Kernel | Implementación y pruebas existentes |
| AW2-2 | Provider Contract | Implementación y pruebas existentes |
| AW2-3 | Orca Provider | Implementado parcialmente; aceptación real completa pendiente |
| AW2-4 | Capabilities & Router | Implementación determinista; integración pendiente |
| AW2-5 | Context Engine | Implementación y persistencia; integración pendiente |
| AW2-6 | Decision / Artifact Ledger | Implementación y persistencia; verificación material pendiente |
| AW2-7 | Evidence / Verifier | Desarrollo avanzado; cierre completo pendiente |
| AW2-8 | Scheduler & Dependency Engine | Pendiente como hito completo |
| AW2-9 | Planner | Pendiente |
| AW2-10 | Governed End-to-End Loop | Pendiente |
| AW2-11 | Cross-Provider Execution | Pendiente |
| AW2-12 | Recovery Matrix | Pendiente integral; hay pruebas parciales de recuperación |
| AW2-13 | Control API / CLI | API parcial en PYMES; contrato completo pendiente |
| AW2-14 | Control Center UI | Interfaz inicial real; aceptación completa pendiente |
| AW2-15 | Learning Router | Pendiente; empezar en shadow y desactivado por defecto |

### 5.3 Producto PYMES e interfaz

Pantallas existentes: resumen de la mañana, bandeja, cola de revisión, clientes, tareas, agenda, preparación de llamadas, propuestas/intake, pólizas, automatizaciones, configuración, ayuda/instalación Mac y centro de agentes V2.

Se han separado vistas y navegación, compartido un snapshot de demo y refinado la interfaz. Hay datos ficticios explícitos y estados vacíos donde no existe conexión. La identidad desconocida requiere revisión. No se recoge libremente un cuestionario sensible de vida en la demo.

Backend existente: API autenticada por tenant, roles, repositorio SQLite, sesiones, revisiones, efectos, workers y métricas/cola de atención. Existen scripts de validación operativa, ejemplos Compose/Kubernetes y scripts de backup/verificación. **Su existencia no prueba que una instalación real haya superado todas las pruebas de entrega.**

### 5.4 Cambios recientes: interfaz conectada al runtime

- `runtime-source.ts` abre un journal separado en `PYMES_RUNTIME_DB_PATH`, por defecto `./data/pymes-task-runtime.db`.
- Vincula la base a un tenant y rechaza cambios de tenant, journals incompatibles y fallos de replay. No sustituye silenciosamente datos por una demo.
- API autenticada para listar tareas, consultar detalle y crear una tarea con `{id, goal}`.
- La identidad propietaria viene de la sesión; el cliente no decide autoridad ni propietario.
- Crear con el mismo ID, objetivo y propietario es idempotente; un conflicto devuelve 409.
- La creación añade un criterio futuro de revisión profesional. **No significa que el usuario ya haya aprobado una acción.**
- Crear una tarea deja su estado inicial; no genera un plan, inicia un actor ni produce efectos externos.
- Lecturas filtradas por propietario y roles; el worker no obtiene acceso a estas rutas de lectura de runtime.
- DTO sin comandos crudos, argumentos sensibles de criterios ni cuerpos de contexto/proveedor.
- Cliente con timeout, límite de respuesta y validación; guarda estados desconocidos.
- Pantalla con selección, unidades, dependencias, intentos, evidencia e historial cuando esos datos existen.
- Respuestas tardías no sustituyen una selección más reciente; un fallo de conexión real muestra indisponibilidad y limpia datos obsoletos.
- Formulario de creación conserva UUID al reintentar el mismo objetivo para evitar duplicados por incertidumbre.
- Configuración de URL, tenant y clave de sesión; comprobación de conexión y almacenamiento temporal en `sessionStorage`.
- Corrección de `fetch` en WebKit y cabecera CORS `Cache-Control`.
- Comprobación visual en navegador de conexión, creación y recarga sobre SQLite de QA.

La autenticación actual es de piloto. Falta un onboarding profesional de usuarios, cuentas, recuperación, permisos y gestión de sesiones. El journal del producto registra actualmente tenant binding y task runtime; **no integra todavía todos los ledgers V2 y C12 en un único ciclo de producto**.

## 6. Conexiones: código disponible frente a conexión real

| Sistema | Base existente | Qué falta demostrar/configurar |
|---|---|---|
| Ollama | Cliente local y clasificación estructurada, diagnóstico y benchmark | Servicio activo, modelo elegido y calidad con casos representativos |
| WhatsApp Business | Webhook, challenge, firma y deduplicación; controles de remitentes/conversaciones | Cuenta/número/credenciales autorizados, HTTPS y prueba real de lectura y respuesta aprobada |
| Holded | Lectura mediante API y salidas de CRM vía adaptadores/gateway | Cuenta real, mapeo de contactos/expedientes, escritura y verificación |
| Google Calendar | Lectura y efectos de calendario | OAuth/refresh de tokens, scopes, zona horaria, conflictos y prueba real |
| Telegram / email / iMessage | Contratos genéricos e ingress/gateway para integrar canales | Conector concreto, permisos y validación; no hay prueba de todos estos canales conectados |
| Telefonía | Preparación y contrato/gateway de salida | Proveedor, alcance, consentimientos y prueba; no asumir llamadas automáticas |
| Aseguradoras | Formularios/borradores | Tarifadores/API, documentación y aceptación de ofertas reales |
| OpenClaw Enterprise | Adaptación de contratos/ingress con controles | Auditoría de compatibilidad, dependencias y uso real del despliegue elegido |

Instalar WhatsApp, Telegram, Mail o un navegador no establece una integración automática. Debe decidirse por canal si se usa API oficial, gateway o integración local, y qué cuenta/conversaciones puede leer.

El usuario ha propuesto aprovechar [OpenClaw](https://github.com/openclaw/openclaw) y [OpenClaw Enterprise](https://github.com/openclaw/openclaw-enterprise). Incorporar piezas útiles después de revisar versión, licencia, permisos y peso operativo. Los adaptadores deben conservar nuestra autoridad, idempotencia y verificación. No está demostrado que una instalación completa de Enterprise sea necesaria en cada Mac cliente.

## 7. Pruebas y evidencia disponible

Última ejecución registrada:

| Comprobación | Resultado |
|---|---|
| Tests de todos los workspaces | 661 total; 660 pasan; 0 fallos; 1 omitido |
| Typechecks de workspaces | Pasan |
| Build de workspaces | Pasa |
| Check PYMES | Pasa |
| Navegador: conectar sesión, crear tarea, recargar | Pasa en entorno QA con datos ficticios |
| Trabajo real Orca completo | Pendiente |
| Canales reales de cliente y proceso completo | Pendiente |
| Instalación comercial, reinicio, restauración integral | Pendiente |

Logs locales, temporales y no versionados:

- `/tmp/aw2-create-full-tests.log`
- `/tmp/aw2-create-full-types.log`
- `/tmp/aw2-create-full-build.log`
- `/tmp/aw2-create-final-check.log`

Capturas QA: `/tmp/pymes-runtime-live.jpg`, `/tmp/pymes-runtime-created.jpg`, `/tmp/pymes-runtime-session.jpg`.

La cobertura automatizada incluye límites, aislamiento, idempotencia, incertidumbre y recuperación. El número de pruebas no certifica calidad comercial, seguridad total ni todas las integraciones externas.

### Puertos y demostración

Defaults documentados: API 8790, Vite 5174, servidor UI compilada 5175. En la sesión de trabajo se utilizó **5176** porque 5174 estaba ocupado por otra aplicación.

Preview utilizada: `http://127.0.0.1:5176/`. API QA: `http://127.0.0.1:8899`, tenant sintético `qa-runtime`. Persistencia QA: `/tmp/aw2-browser-qa-20261003/live-runtime.db` y `live-workspace.db`.

No son endpoints comerciales ni datos de clientes; los procesos pueden dejar de estar activos. No se incluye ninguna clave de sesión en este documento.

## 8. MacBook de 24 GB: inventario comprobado

| Elemento | Estado observado |
|---|---|
| Equipo | MacBook Air, modelo Mac16,13 |
| Procesador | Apple M4, 10 núcleos: 4 rendimiento + 6 eficiencia |
| Memoria | 24 GB unificados |
| Sistema | macOS 27.0.1 según el equipo |
| Node / npm | v26.9.0 / 11.19.1 |
| Homebrew / Git | Binarios presentes en `/opt/homebrew/bin` |
| Ollama | Binario presente en `/opt/homebrew/bin/ollama` |
| Servicio Ollama | **No disponible al comprobarlo:** `ollama list` no conecta al servidor |
| Modelo local | Manifest de `llama3.2:3b` presente en disco; falta validación actual con el servicio arrancado |
| Orca | `/Applications/Orca.app` existe |

CLI público usado para Orca: `/Applications/Orca.app/Contents/Resources/bin/orca`. Un acceso previo por `/usr/local/bin/orca` estaba roto; no se ha corregido ese enlace como parte de este informe.

Se registró anteriormente un benchmark pequeño de llama3.2:3b en 24 GB: primera clasificación alrededor de 2,9 s y posteriores aproximadamente 0,47–0,56 s. Es una muestra limitada e histórica, no una garantía de calidad o rendimiento general.

**En este trabajo de documentación no se han instalado aplicaciones ni descargado modelos.**

## 9. Propuesta de instalación — pendiente de validar

### Instalación mínima del producto

1. Runtime Node con versión fijada y probada; el repo exige `>=22`, pero hay que validar exactamente la versión distribuida, incluidos `node:sqlite` y scripts de ejecución. Actualmente las pruebas pasan con 26.9.0.
2. API PYMES, runtime, SQLite y worker autorizado.
3. Interfaz compilada y navegador. Vite/HMR sirve para desarrollo.
4. Ollama local, un modelo seleccionado y endpoint en loopback.
5. Supervisión y arranque automático de API, UI, worker y modelo según la configuración elegida.
6. Gestión de secretos, logs rotados, diagnóstico y backups consistentes con prueba de restauración.
7. Configuración de cuentas/conectores autorizados.

Docker y Kubernetes tienen plantillas existentes, pero **no son requisitos del diseño propuesto para un único Mac**. Evaluar ejecución nativa antes de aumentar consumo y mantenimiento. Codex, Claude, editor y herramientas de compilación pertenecen al equipo de desarrollo salvo que el producto requiera expresamente una de ellas.

Orca debe ser opcional si el cliente solo necesita el asistente de negocio. Un proveedor de coding no aporta por sí mismo acceso a su CRM ni a sus conversaciones.

### Modelos para evaluar

| Modelo | Uso propuesto | Estado y decisión |
|---|---|---|
| llama3.2:3b | Baseline rápido de clasificación/extracción acotada | Ya utilizado; comprobar servicio y calidad actual |
| qwen3:8b cuantizado | Candidato para español, resúmenes y borradores más complejos | No instalado/verificado en este trabajo; compararlo antes de elegir |
| Modelos mayores | Solo si mejoran claramente calidad y caben con las aplicaciones habituales | Pendiente; no prometer rendimiento por tamaño de descarga |

La ficha oficial de [llama3.2:3b](https://ollama.com/library/llama3.2:3b) muestra unos 2,0 GB y licencia Llama 3.2. La de [qwen3:8b](https://ollama.com/library/qwen3:8b) muestra unos 5,2 GB en Q4_K_M y licencia Apache 2.0. **Ese tamaño no es el consumo total de RAM:** contexto, caché y otros procesos también cuentan. Revisar licencias y obligaciones de distribución antes de empaquetar modelos.

[Ollama documenta soporte de macOS y aceleración Apple Silicon](https://docs.ollama.com/macos). Elegir una sola vía de instalación/arranque para evitar servicios duplicados. La instalación existente por CLI debe revisarse antes de añadir la app.

Propuesta inicial: una inferencia simultánea, contexto acotado y respuestas estructuradas validadas. No dar al modelo acceso directo a herramientas externas con credenciales. Separar benchmarks de clasificación, resumen y redacción. La nube sería opcional y requiere una decisión explícita de política de datos y coste.

### Apps, secretos y operación

- Google Calendar y Holded pueden integrarse por servicios web; sus apps nativas no son un requisito automático.
- Resolver Gmail/Outlook/IMAP según la cuenta real del piloto.
- Definir API de WhatsApp Business, Telegram e iMessage por separado; documentar permisos y limitaciones.
- Propuesta: secretos en Keychain de macOS y permisos de archivos mínimos; la integración completa con Keychain aún no está demostrada.
- Propuesta: FileVault, copia cifrada y recuperación probada de ambas bases y configuración. Time Machine puede complementar, pero necesitamos un backup consistente de la aplicación.
- Existe un generador LaunchAgent para UI. No inicia por sí solo API, Ollama y worker. Falta validar el conjunto tras reinicio, inicio de sesión, suspensión y recuperación.
- SQLite/WAL deben respaldarse de forma consistente, con procesos detenidos o mecanismo de backup adecuado; no copiar una base activa sin coordinación.
- Debe definirse qué sucede con el Mac apagado: los webhooks externos requieren un endpoint accesible, y un portátil suspendido no garantiza recepción continua.

### Benchmark de aceptación

Ejecutar en el hardware de entrega, con navegador y apps habituales abiertas:

- Corpus representativo en español, anonimizado o sintético, con etiquetas esperadas.
- 30–60 casos por perfil y casos difíciles: identidad ambigua, urgencia, datos faltantes, mensajes maliciosos e instrucciones embebidas.
- Medir latencia fría/caliente, percentiles, memoria/presión/swap, CPU, disco y errores de formato.
- Medir precisión de clasificación, omisiones y calidad de borradores; no basta medir velocidad.
- Probar límites de contexto, fallo de Ollama y reanudación.
- Comparar 3B y 8B manteniendo el mismo corpus.
- Repetir en 16 GB si se mantiene ese perfil comercial.

## 10. Qué falta para venderlo

### Prioridad 1 — cerrar arquitectura y un flujo vertical real

- Cerrar AW2-7 y registrar la evidencia/colecciones necesarias en almacenamiento durable de producto.
- Scheduler AW2-8: readiness, dependencias, waves, bloqueo, leases/política/presupuesto y recuperación tras reinicio.
- Planner AW2-9: validar planes, ciclos, capacidades, objetivos e historial/versiones.
- Bucle AW2-10: propuesta → plan → contexto → dispatch → observación → verificación → actualización visible.
- Seleccionar un canal real, un CRM y Calendar para el primer piloto.
- Completar el flujo de mañana y una escritura aprobada/verificada.
- Evitar duplicados tras timeouts, caída y reapertura. Mostrar `UNKNOWN` y procedimiento de resolución.

### Prioridad 2 — producto profesional

- Onboarding de usuario y cuentas; permisos comprensibles y revocables.
- Identidad de clientes, deduplicación y mapeo CRM sin mezclar expedientes.
- OAuth, refresh y revocación de tokens; rotación y recuperación de sesión.
- Preview de cambios/aprobaciones y auditoría útil para el profesional.
- Búsqueda, filtros, estados vacíos, accesibilidad, responsive y consistencia visual.
- Conexión entre tareas V2 y bandeja, agenda, CRM y efectos; hoy son piezas parcialmente integradas.
- Tarifación/documentación de aseguradoras si se promete preparar ofertas reales.
- Exportación de datos, retención y eliminación; revisión de privacidad/seguridad con especialistas antes de comercializar.

### Prioridad 3 — entrega y mantenimiento

- Instalador reproducible, versiones fijadas y ubicación estable fuera de Downloads.
- Arranque y salud de todos los servicios; no depender de terminales de desarrollo.
- Actualizaciones, migraciones y rollback probado sin perder datos.
- Backup/restauración de todas las bases y secretos/configuración necesarios.
- Diagnóstico sencillo, logs sin contenidos sensibles y soporte con acceso consentido.
- Comportamiento con suspensión, red caída, disco lleno, modelo caído y cuentas desconectadas.
- Pruebas de carga y presupuesto del hardware vendido.
- Modelo de licencia, mantenimiento, soporte y costes de terceros.

### Riesgos concretos para revisar

- No confundir reportes/artefactos declarados con evidencia verificada.
- Integrar todos los journals/stores sin pérdida de autoridad o divergencia entre bases.
- Revisar aislamiento por tenant/propietario y todas las mutaciones, no solo GET de runtime.
- Evaluar gestión del token en navegador y onboarding antes de multiusuario real.
- Mantener worker único por tenant mientras no exista adquisición atómica de leases expuesta e integrada por API; hay store SQLite, pero eso no acredita despliegue multiworker completo.
- Reconciliar incertidumbre de gateways/proveedores antes de reintentar un efecto.
- Revisar inputs, límites, CORS y exposición de servicios según el despliegue elegido.
- El portátil local y un webhook público tienen necesidades operativas distintas; diseñar el puente de recepción.

## 11. Dudas para el usuario y Claude

Estas decisiones siguen abiertas; no asumir respuestas por silencio.

### Producto y hardware

1. ¿El MacBook de 24 GB es desarrollo, piloto o el equipo que recibirá cada cliente?
2. ¿Seguimos vendiendo Mac mini de 16 GB, cambiamos a 24 GB o damos dos configuraciones?
3. ¿Seguros será la primera vertical exclusiva o el producto debe atender varias profesiones desde el inicio?
4. ¿Cuáles son las tres tareas prioritarias y cuánto tiempo consumen hoy?
5. ¿Una persona por instalación o varios empleados/roles/agencias?
6. ¿“Protección civil a autónomos” significa responsabilidad civil profesional, general u otro seguro?

### Datos y conexiones

7. ¿Qué CRM usa el primer piloto hoy? ¿Aceptamos Holded solo después de validar su encaje?
8. ¿Qué correo: Gmail, Microsoft 365 u otro? ¿Qué cuentas/calendarios concretos?
9. ¿WhatsApp Business o WhatsApp personal? ¿Qué número y qué conversaciones se autorizan?
10. ¿Telegram necesita leer conversaciones existentes o funcionar con un bot?
11. ¿iMessage es imprescindible en la primera versión?
12. ¿Qué aseguradoras, herramientas de mediación y formatos de propuesta se utilizan?
13. ¿Tenemos posibilidad real de acceder a sus APIs o solo documentación manual?

### Autonomía, privacidad y costes

14. ¿Solo inferencia local o nube opcional con autorización y reglas por dato/tarea?
15. ¿Qué acciones siempre requieren aprobación: enviar, crear cita, modificar CRM, llamar, proponer coberturas?
16. ¿El sistema estará encendido siempre? ¿Permitimos un servicio de recepción fuera del Mac?
17. ¿Volumen diario de mensajes/clientes y latencia aceptable?
18. ¿Presupuesto mensual de conectores/modelos/infraestructura y soporte?
19. ¿Quién administra copias, actualizaciones y asistencia remota?
20. ¿Venta del equipo + cuota, licencia mensual o instalación y mantenimiento por separado?

### Decisiones técnicas para Claude

21. ¿Cómo integrar los stores V2 y C12 con atomicidad/recuperación clara en el producto?
22. ¿Qué pieza mínima de OpenClaw Enterprise aporta valor sin introducir un stack innecesario?
23. ¿Qué proveedor real se usará primero para ejecutar y verificar una tarea V2 completa?
24. ¿Qué modelo gana en nuestro corpus y qué licencia/forma de distribución usaremos?
25. ¿Qué criterios demuestran que un piloto ya puede convertirse en producto comercial?

## 12. Instrucciones de revisión para Claude

1. Leer este documento, la especificación V2 y los archivos reales relevantes.
2. Inspeccionar Git y preservar el árbol actual, incluidos untracked.
3. Verificar baseline con los scripts reales; no reconstruir desde el PDF.
4. Entregar diagnóstico con evidencia: implementado, parcial, demo y pendiente.
5. Corregir inconsistencias documentales y mapear hitos a la numeración correcta.
6. Priorizar el cierre de verificación y un flujo real antes de ampliar canales/modelos.
7. Proponer instalación concreta para 24 GB, presupuesto de memoria y plan de recepción de mensajes con el Mac suspendido.
8. Proponer seguridad/secretos, migraciones, backup/restore y actualizaciones con criterios comprobables.
9. Consultar al usuario las decisiones de producto antes de contratar, activar cuentas externas o enviar mensajes.

Comandos de revisión desde el repo:

```bash
cd /Users/mac/Downloads/agent-world-os
git status --short
git log -5 --oneline
cat package.json
cat pymes/package.json
npm test
npm run typecheck --workspaces --if-present
npm run build
npm run check:pymes
```

Para el benchmark, una vez configurado el servicio local:

```bash
npm run diagnose:mac --workspace=@agent-world/pymes
npm run benchmark:local --workspace=@agent-world/pymes
```

No ejecutar `npm install` automáticamente para “arreglar” un baseline sin entender versiones y cambios en el lockfile. No ejecutar restauraciones destructivas de las guías sobre las bases actuales.

### Resultado esperado de la revisión

- Inventario verificado de funcionalidades y lagunas.
- Lista priorizada de fallos/riesgos con archivo y evidencia.
- Decisiones que necesita tomar el usuario.
- Plan de 3 entregas: flujo real, piloto estable e instalación comercial.
- Criterios de aceptación y estimación después de resolver dependencias.

## 13. Definición propuesta de una primera entrega vendible

Un profesional puede instalar/configurar el producto, conectar cuentas autorizadas, obtener una revisión de mañana útil, aprobar una respuesta o cita y comprobar el resultado. Las tareas y auditoría sobreviven a un reinicio. Un resultado incierto no duplica acciones. Los fallos se explican y permiten recuperación. La copia se restaura en un equipo limpio. El modelo funciona dentro del presupuesto de memoria. Existe un procedimiento de actualización y soporte.

**Esta definición aún no se ha cumplido integralmente.** Es el criterio hacia el que debe avanzar el trabajo existente.
