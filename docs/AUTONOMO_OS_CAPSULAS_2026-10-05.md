# Autónomo OS: aplicación común y cápsulas adaptables

Fecha: 5 de octubre de 2026.
Base inspeccionada: `39772ffefd76210adf425e941dcbe1c524e68e60`.
Investigación complementaria: [revisión de candidatos de Grok](REVISION_GROK_REUTILIZACION_2026-10-05.md).
Estado inicial: propuesta de arquitectura. La actualización siguiente distingue
la primera implementación del alcance todavía pendiente.

## Actualización de implementación

La primera entrega funcional está implementada: SDK declarativo v1, registro,
configuración durable por propietario, pantalla Mi Autónomo OS, primera cápsula
de lectura CRM y kit editable. Véase [entrega y evidencias](handoff/AVANCE_CAPSULAS_FUNDACION_2026-10-05.md).
El resto de este documento conserva la propuesta de alcance futuro; no acredita
instalación de código arbitrario, sandbox, marketplace ni conectores nuevos.

## 1. Producto

Una web app común donde cada profesional compone su propio Autónomo OS mediante
cápsulas reutilizables. Puede configurar las existentes, derivar una variante o
crear una nueva con Claude/Codex. La aplicación sigue pudiendo operar localmente
en el Mac; web app no implica trasladar los datos a un servicio cloud.

Una cápsula puede aportar pantallas, formularios, modelos de dominio, reglas,
preparación de tareas o integración con un servicio. Varias cápsulas forman un
módulo funcional; un conjunto configurado forma una plantilla de profesión.

Ejemplo: el agente de seguros instala Clientes, Correo, Renovaciones y Preparación
de llamadas. Un consultor reutiliza Clientes y Correo, y añade Proyectos y Horas.
La cápsula Calendario será una integración posterior: no existe aún un conector
real acreditado en el producto.

## 2. Tres capas

| Capa | Responsabilidad |
| --- | --- |
| Base común | Navegación, identidad/workspace, configuración, diseño visual, conexiones, revisión, historial y diagnóstico |
| Runtime existente | Contratos C1–C12, journal, replay, aprobación, Governed Runner, C6/UNKNOWN y recuperación |
| Cápsulas | Funciones, pantallas y procesos particulares; usan servicios autorizados de las dos capas anteriores |

La lista de pantallas y los menús deberán proceder del registro de cápsulas
habilitadas. La interfaz de seguros pasará a ser una plantilla de esta base.
La extracción será gradual: se conserva el checkout y se reutilizan sus servicios.

## 3. Relación con HUBLAB

Referencia: <https://github.com/aulafy/hublab>.
Su documentación describe catálogo de componentes/cápsulas, configuración,
composición de páginas y exportación de código. Adoptamos esa experiencia como
referencia. Esto no acredita compatibilidad binaria ni seguridad de sus cápsulas.

Antes de reutilizar código concreto: inspeccionar implementación, dependencia,
licencia y tests del fichero elegido y fijar su versión. No incorporar ejemplos
de secretos en cliente, ejecución dinámica o credenciales compartidas.

Fuentes consultadas:

- <https://github.com/aulafy/hublab/blob/main/README.md>
- <https://github.com/aulafy/hublab/blob/main/BLOCKS_SYSTEM.md>
- <https://github.com/aulafy/hublab/blob/main/GITHUB_TO_CAPSULE.md>

## 4. Contenido propuesto de una cápsula

- Identificador estable, versión, autor, licencia y compatibilidad de SDK.
- Descripción de su utilidad, pantallas y configuración validada por esquema.
- Capacidades requeridas, datos accesibles y conexiones necesarias.
- Entradas, salidas y eventos con esquemas explícitos.
- Dependencias con versiones fijadas y digest del artefacto instalado.
- Código fuente y documentación legible por Claude/Codex.
- Tests con datos sintéticos y ejemplos reproducibles.
- Cambios de datos y migraciones, cuando sean necesarios.

Estos campos son un diseño: no sustituir los contratos actuales por interfaces
inventadas. El SDK debe adaptar los contratos reales de task-runtime,
capabilities, resources, execution-providers y las APIs de pymes.

## 5. Crear o adaptar con IA

Flujo previsto:

1. Elegir una plantilla o duplicar una cápsula bajo una identidad nueva.
2. Describir la necesidad: «prepara llamadas para renovaciones a 30 días».
3. Exportar un paquete de desarrollo con contrato SDK, fuentes, ejemplos y tests.
   Usar datos sintéticos por defecto; las credenciales no forman parte del paquete.
4. Claude/Codex devuelve una versión editable con código y tests.
5. Validar manifest, compatibilidad, dependencias, permisos y tests.
6. Previsualizar con una cuenta/workspace QA aislados y sin envíos reales.
7. Mostrar cambios, permisos adicionales y migraciones antes de activar.
8. Activar una versión concreta y conservar el historial de instalación.

Primero soportar el intercambio de archivos/proyecto con los asistentes.
Una integración conversacional dentro de la app sería un incremento posterior;
no depender de automatizar las interfaces de Claude o Codex para instalar módulos.

## 6. Ejecución y garantías

Declarar una capacidad no concede acceso. El host decide los permisos efectivos
por tenant/propietario y ejecuta las acciones mediante servicios autorizados.

Una cápsula propone una tarea de correo, cita o escritura; la aprobación y el
efecto pertenecen al runtime. Ninguna cápsula obtiene directamente los tokens de
Keychain ni acceso de escritura al journal/claims. Se conservan UNKNOWN,
reconciliación, evidencia y las reglas de cancelación de P10.

No ejecutar código desconocido dentro del servidor principal o en el mismo origen
de la UI autenticada. Ocultar botones, un manifest o un worker por sí solos no
constituyen aislamiento de seguridad. La primera entrega usará cápsulas
declarativas y código propio revisado; ejecutar código personalizado requiere
un host aislado y un puente de capacidades, con pruebas de acceso indebido.

No presentar un importador de archivos arbitrarios como seguro antes de tener
esa frontera implementada. Las cápsulas de conectores con secretos se revisan e
integran en el host; no pueden convertir un permiso de lectura en envío.

## 7. Versiones y datos

- Instalaciones y configuración durables y separadas por workspace/propietario.
- Los trabajos conservan referencia a la versión/digest que los preparó.
- Actualizar una cápsula no cambia una aprobación pendiente ni una tarea histórica.
- Deshabilitar bloquea nuevos trabajos, conserva datos/historial y permite al
  runtime observar/reconciliar efectos ya despachados.
- Volver a una versión anterior no deshace envíos ni revierte una migración de
  datos automáticamente. Las migraciones requieren validación y backup/restore.
- Configuración del profesional separada del código de la cápsula.
- Derivar una cápsula preserva procedencia y licencia; actualizar no sobrescribe
  silenciosamente las modificaciones del usuario.

## 8. Orden de implementación propuesto

1. Contrato de manifest/SDK, registro y validación; tests de incompatibilidad,
   dependencias y permisos. Mantener el namespace de los contratos existentes.
2. Shell genérico y navegación por registro. Extraer una primera cápsula de
   lectura usando servicios existentes; comparar el comportamiento anterior.
3. Pantalla «Mi Autónomo OS»: disponibles, instaladas, configuración, versión,
   permisos, habilitar/deshabilitar y estado real de conexiones.
4. Plantilla Seguros y cápsulas Clientes/Correo apoyadas en P03–P11. Las acciones
   siguen pasando por revisión y ejecución gobernada.
5. Kit «Crear mi cápsula»: generador de proyecto, guía para IA, QA y preview.
   Evaluar MCP Apps y su SDK de host/app-bridge con una vista sintética de lectura;
   su compatibilidad todavía no está acreditada en nuestro shell.
6. Host aislado para lógica personalizada; validar fronteras antes de activación.
7. Importación, actualización y rollback de paquetes; catálogo compartido después.

No se ha autorizado publicación automática de nuevas versiones ni se ha elegido
un proveedor cloud obligatorio. La base local actual es el punto de partida.

## 9. Criterios de aceptación

- Dos plantillas diferentes funcionan sobre la misma base y navegación.
- Una cápsula se configura sin modificar el kernel ni editar HTML del shell.
- Un paquete inválido o incompatible se rechaza con error concreto.
- Cambios de permisos requieren decisión explícita; aislamiento probado.
- La versión instalada y la configuración sobreviven a restart/SIGKILL.
- Deshabilitar no elimina claims ni impide reconciliar UNKNOWN.
- Historial y aprobaciones mantienen identidad exacta después de actualizar.
- Prueba visual con QA sintético; error real sin fallback a datos de ejemplo.
- Suite relevante y gates completos al introducir código ejecutable.

## 10. Estado de esta entrega

Solo documentación. Repositorio y contratos inspeccionados, sin cambios de código
ni instalación de HUBLAB. No se han ejecutado suites: esta entrega no cambia el
comportamiento del producto. Las capacidades descritas son objetivos por construir.

## 11. Conectores reutilizables: APIs y MCP

Requisito añadido por el usuario: conectar WhatsApp, Telegram, Odoo, WordPress,
CRM y otros servicios mediante API o MCP, eligiendo por calidad de integración.

Una cápsula describe el proceso de negocio. Un conector implementa acceso a una
cuenta del servicio. Varias cápsulas comparten el conector y cada una recibe solo
las capacidades autorizadas. Instalar una cápsula no conecta cuentas por sí solo.

### Elección inicial

| Servicio | Transporte preferido | Alcance inicial |
| --- | --- | --- |
| Gmail | API existente | Reutilizar M3 y P03–P11; adaptar al registro común |
| WhatsApp | Business Platform / Cloud API oficial | Mensajes y eventos de las cuentas/números conectados; validar onboarding y recepción |
| Telegram | Bot API oficial | Canal del bot y chats autorizados; polling durable en el Mac como primera opción |
| Odoo | API según versión/despliegue | Contactos, oportunidades y actividades, primero lectura |
| WordPress | REST API | Lectura de contenido y preparación de borradores; creación/publicación gobernadas |
| CRM | Adaptadores concretos | Holded y Odoo como primeras opciones; HubSpot evaluable por API/MCP oficial |
| Calendar/Drive | APIs oficiales | Lectura y luego operaciones concretas con sus permisos y recuperación |
| Otros MCP | Cliente MCP del host | Incorporar servidores evaluados y herramientas permitidas explícitamente |

API y MCP no son alternativas excluyentes: un servidor MCP puede envolver una
API. Usar API directa para jobs, sincronización y control de recibos cuando
ofrezca mejores garantías; MCP para interoperabilidad de herramientas y acceso
desde asistentes cuando sus contratos sean adecuados. Ambas rutas llegan a la
misma autorización y ejecución gobernada; no crear dos caminos de envío.

WhatsApp Business Platform no debe presentarse como lectura universal de todos
los chats personales. Telegram Bot API tampoco equivale a importar el buzón
personal: para ese alcance haría falta evaluar por separado Telegram API/TDLib,
autorización, retención e identidad. No prometer historial previo indiscriminado.

Para Odoo, detectar versión, modelos disponibles y permisos: JSON-2 aparece en
Odoo 19. La documentación limita la API externa de las ofertas alojadas a planes
Custom; comprobar el despliegue concreto antes de ofrecer conexión. No asumir
que todos los clientes Odoo usan las mismas entidades o módulos.

WordPress autohospedado y WordPress.com pueden requerir autenticación distinta.
Para autohospedado, REST con Application Password revocable y HTTPS cuando esté
habilitado; asignar un usuario con permisos acordes al alcance.

### Contrato que debe cubrir el SDK de conectores

- Identidad de proveedor y versión del adaptador, conexiones aisladas por
  tenant/propietario y cuenta externa acreditada.
- Alta, autenticación, estado comprobado, permisos efectivos, revocación y
  reconexión. Guardar secretos mediante el vault del host, Keychain en Mac.
- Operaciones con esquemas, clasificación de efectos y límites explícitos.
  Clasificar semánticamente: un POST de búsqueda puede ser lectura.
- Sincronización durable: cursores, paginación, deduplicación por cuenta/id/evento,
  budgets, backoff y fencing; conservar procedencia y cambios de identidad.
- Escrituras: preparación, revisión/aprobación, claim, dispatch, recibo y
  observación/reconciliación conforme a los contratos existentes.
- Separar aceptación del proveedor, entrega y lectura por el destinatario.
- Declarar garantías reales de idempotencia y observabilidad por operación.
  Una clave local o un header inventado no garantizan idempotencia externa.
- Ante pérdida de respuesta de escritura, conservar UNKNOWN si no hay prueba.
  No reintentar ciegamente. Algunos proveedores no permiten resolver la duda de
  forma automática: documentar esa limitación y mantener la evidencia.
- Errores y diagnóstico sin credenciales ni cuerpos de clientes en logs/prompts.

### MCP

Los nombres y annotations de herramientas recibidas no conceden permisos ni
prueban ausencia de efectos. Mapear herramientas concretas a operaciones revisadas;
rechazar cambios inesperados de esquema/identidad y limitar salida, tiempos y red.
La aprobación liga cuenta, herramienta, versión y argumentos efectivos.

Un servidor MCP de terceros no recibe acceso global al Keychain. Las credenciales
necesarias para autenticarlo se gestionan y limitan por conexión. Su código local
y su servicio remoto requieren evaluación; MCP no proporciona por sí mismo el
aislamiento del host. El contenido de herramientas/documentos es dato, no una
instrucción autorizada para cambiar permisos o ejecutar efectos.

### Recepción cuando el producto vive en un Mac

Los webhooks necesitan un endpoint alcanzable y verificable. Para los servicios
que lo exijan, evaluar un relay HTTPS con colas y entrega autenticada al Mac;
decidir alojamiento, retención y alcance de datos antes de producción. No exponer
la API local completa ni introducir ese servicio cloud sin documentarlo.

Validar autenticidad por el mecanismo del proveedor, almacenar eventos aceptados
antes de confirmarlos, soportar duplicados/desorden y no usar un tenant/owner
proporcionado por el payload para decidir el destino. El Mac puede estar apagado;
la política de cola y los límites de recuperación deben ser visibles.

### Trabajo existente y primera secuencia

`pymes/src/connectors.ts` y `provider-effect-handlers.ts` ya contienen helpers de
Holded, Calendar y mensajes. Revisar y adaptar esos módulos; no reconstruirlos
como si no existieran. Sus retries genéricos también se usan en escrituras:
auditar ese comportamiento antes de incorporar nuevas acciones al producto.
Gmail tiene su ruta acreditada propia, que se conserva.

1. Registro común y SDK: conexiones, permisos, errores y estado real en UI.
2. Adaptación de Gmail y un conector Telegram de lectura para validar el contrato.
3. WhatsApp oficial: recepción durable primero y envío gobernado después.
4. Odoo/Holded: lectura, vínculo de identidad y propuesta de cambios; definir
   origen de verdad por campo antes de sincronización bidireccional.
5. WordPress: lectura, borradores y publicación con revisión/versiones.
6. Puente MCP con un servidor concreto y herramientas verificadas; ampliar por
   evidencia de compatibilidad, no mediante ejecución libre de cualquier tool.

La pantalla «Conexiones» distinguirá disponible, no configurado, conectado,
permisos insuficientes, error y validación pendiente. No marcar conectado por
tener un token o un botón; mostrar última comprobación/sync y alcance efectivo.

Cada conector exige tests sintéticos de aislamiento, duplicados, pérdida de
respuesta y restart/SIGKILL; después validación real con cuenta dedicada. No se
han creado ni conectado estos adaptadores nuevos en esta entrega documental.

### Documentación oficial consultada

- WhatsApp: <https://www.postman.com/meta/whatsapp-business-platform/overview>
- Telegram: <https://core.telegram.org/bots/api>
- Odoo: <https://www.odoo.com/documentation/19.0/developer/reference/external_api.html>
- WordPress: <https://developer.wordpress.org/rest-api/>
- Credenciales WordPress: <https://developer.wordpress.org/advanced-administration/security/application-passwords/>
- Holded: <https://www.holded.com/developers/api-reference>
- HubSpot MCP: <https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server>
- MCP: <https://modelcontextprotocol.io/docs/learn/architecture>
