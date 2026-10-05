# Revisión de la investigación de Grok: cápsulas y conectores

Fecha: 5 de octubre de 2026.
Checkout: `/Users/mac/Downloads/agent-world-os`.
Base local: `39772ffefd76210adf425e941dcbe1c524e68e60`.
Alcance: contraste de documentación, metadatos GitHub, licencias y archivos
seleccionados. No es una auditoría completa del código externo ni una prueba de
ejecución, seguridad, consumo de memoria o compatibilidad de todos los candidatos.

## 1. Conclusión

La investigación aporta candidatos útiles para reducir trabajo. La prioridad
es el contrato propio de cápsulas, la adaptación de los servicios actuales y un
puente MCP sobre el runtime existente. Reutilizar bibliotecas concretas cuando
encajen; toda operación mantiene autorización, aprobación y evidencia del host.

Una aportación adicional importante es **MCP Apps**, cuyo SDK contempla tanto
interfaces como hosts que las incorporan. Puede servir para una prueba de preview
en nuestra web app. No es obligatorio para cada cápsula ni aísla su backend.
[Repositorio y SDK](https://github.com/modelcontextprotocol/ext-apps).

## 2. Acceso al repositorio

La API pública de GitHub devolvió 404. La consulta autenticada de `gh api
repos/aulafy/autonomoOS` confirmó que existe, es **privado** y su rama por defecto
es `main`. El 404 de Grok es coherente con ese estado; no significa que falte el
repositorio. No se ha cambiado su visibilidad ni publicado contenido adicional.

La evaluación se apoya en el checkout real. Grok no pudo contrastar nuestros
contratos y sus interfaces propuestas deben tratarse como hipótesis.

## 3. Selección técnica

| Candidato | Evidencia contrastada | Decisión propuesta |
| --- | --- | --- |
| [grammY](https://github.com/grammyjs/grammY) | Framework Bot API TypeScript/Node, MIT, proyecto no archivado | Evaluar como biblioteca de transporte/tipos para Telegram; deduplicación y persistencia en nuestro host |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | SDK oficial con cliente/servidor, ejemplos y documentación de v2 | Candidato al puente MCP; fijar paquetes publicados compatibles, no instalar main arbitrariamente |
| [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) | Vistas UI, SDK para host/app-bridge y ejemplos | Prioridad de investigación: preview de una cápsula de lectura con datos sintéticos |
| [Google Workspace MCP](https://github.com/taylorwilsdon/google_workspace_mcp) | MIT, servidor local para APIs Google, repo no archivado | Referencia/adaptador opcional para Calendar y Drive; conservar Gmail acreditado |
| [Twenty](https://github.com/twentyhq/twenty) | Monorepo con licencia global mixta; `packages/twenty-sdk` declara MIT en package.json y LICENSE, comprobados | Estudiar manifest/configuración y generación del SDK; verificar cada fichero/dependencia antes de reutilizar código |
| [Odoo MCP](https://github.com/ivnvxd/mcp-server-odoo) | MPL-2.0, XML-RPC y descripción de modelos/operaciones | Evaluar lectura y mapping; no habilitar métodos genéricos ni modos de acceso total |
| [WordPress MCP adapter](https://github.com/WordPress/mcp-adapter) | Adaptador del proyecto WordPress para Abilities API | Evaluar del lado del sitio del cliente y como alternativa a REST; no asumir cobertura WooCommerce |
| [Holded MCP](https://github.com/cyenis/holded-mcp) | Declara MIT en README/package.json, pero no encontré LICENSE en el árbol consultado | Referencia de operaciones; validar contra API oficial y aclarar artefacto/licencia antes de copiar |
| [Wassette](https://github.com/microsoft/wassette) | MIT, Wasmtime, aviso explícito de desarrollo temprano | Referencia de permisos/aislamiento; no elegirlo aún como runtime comercial |
| [OpenAI MCP extensions](https://github.com/openai/mcp-extensions) | Repo existente, Apache-2.0, superficies orientadas a ChatGPT | Referencia específica; investigar MCP Apps para nuestro host genérico |

No se ejecutaron suites de estos proyectos. Presencia de tests o actividad no
acredita garantías de nuestro flujo. Los plazos y cifras de estrellas de Grok no
se han adoptado como estimaciones de implementación.

## 4. Correcciones a la propuesta de Grok

### Versiones del SDK y licencias

La documentación actual de main del SDK MCP presenta v2 como línea estable y
paquetes separados de cliente/servidor. No tomar `@modelcontextprotocol/sdk
1.32.0` como elección vigente sin verificar publicación y compatibilidad.
El manifest raíz de main no basta para elegir el paquete distribuido.
[README oficial](https://github.com/modelcontextprotocol/typescript-sdk).

Los LICENSE consultados de MCP Apps y SDK describen una transición MIT/Apache-2.0
y documentación CC-BY-4.0. Conservar avisos y comprobar la versión/fichero elegido;
no atribuir una sola licencia a todo un monorepo por el badge o GitHub metadata.
[MCP Apps LICENSE](https://github.com/modelcontextprotocol/ext-apps/blob/main/LICENSE),
[SDK LICENSE](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE).

### Journal y permisos

Una cápsula no recibe permiso directo de append al journal. Propone una operación
mediante una API del host que valida identidad, permisos, esquema y revisión, y
persiste por las rutas existentes. La declaración del manifest no concede acceso.

### Telegram: recepción frente a envío

`update_id` sirve para deduplicar entradas dentro de una conexión/bot. No es la
clave universal de un envío: una entrada puede originar varias operaciones.
Cada acción requiere su propia identidad durable y binding de aprobación.

La propuesta de reconciliación de un envío con respuesta perdida no trae un
mecanismo demostrado para recuperar ese envío. No asumir búsqueda de historial
del bot equivalente a Gmail. Si falta evidencia, mantener UNKNOWN y no reenviar.
[Contrato Bot API](https://core.telegram.org/bots/api).

Para el Mac, empezar por polling de lectura sin abrir un endpoint público. Guardar
eventos deduplicados y avance del cursor de forma durable antes de confirmar
mediante el siguiente offset. Verificar presupuestos, lease y recuperación.

### MCP y tareas pendientes

Una tool que prepara una acción puede devolver un task id durable y estado de
espera de revisión; no necesita permanecer abierta hasta la ejecución externa.
El resultado de la tool distingue aceptación de la solicitud, ejecución y
confirmación del proveedor. El modelo no puede saltarse revisión por usar MCP.

### Aislamiento

Stdio es transporte, no sandbox. Un iframe aislado protege presentación, pero
la autorización de herramientas y el proceso de conectores pertenecen al host.
Demostrar acceso denegado a archivos/red/secretos antes de activar código ajeno.

### Evidencia de X y proyectos secundarios

El texto pegado identifica cuentas y fechas, pero no conserva URLs directas de
posts ni la lista completa de fuentes. Sus afirmaciones en X no quedan acreditadas
en esta revisión. Dyad, bolt.diy, ToolJet, Budibase, NocoBase, Directus y los demás
candidatos secundarios no se han auditado aquí; no adoptarlos por el resumen.
Tampoco asumir precios o condiciones vigentes de proveedores a partir de ese texto.

## 5. Primera entrega propuesta

**Fundación de cápsulas y preview de lectura**, independiente de cuentas reales:

1. Manifest validado, registro de versiones y capacidades; adaptar los contratos
   actuales en vez de crear otro kernel.
2. Una cápsula «Resumen de clientes» sobre la API CRM existente, con QA sintético.
3. Shell que muestra cápsulas habilitadas y su configuración real.
4. Prueba acotada de MCP Apps app-bridge para mostrar la misma vista en preview.
   Si no encaja con el shell actual, registrar resultado y mantener la UI nativa.
5. Paquete de ejemplo para Claude/Codex, con configuración, fuentes y tests.
6. Tests de manifest inválido, versiones incompatibles, aislamiento tenant/owner,
   permisos denegados, actualización e historial, y error real en UI.

Después: Telegram de lectura y puente MCP con herramientas permitidas. WhatsApp,
Odoo y WordPress amplían el registro usando la misma autorización. Los envíos se
incorporan cuando estén definidas y probadas las garantías de cada operación.

## 6. Referencias fijadas de esta consulta

SHAs obtenidos de la API GitHub para sus ramas por defecto; fijan el punto de
investigación, no son paquetes instalados o aprobados para producción:

| Repo | SHA |
| --- | --- |
| grammyjs/grammY | `ee0c650ed0908b2478c12b863afd03aac8e07212` |
| modelcontextprotocol/typescript-sdk | `8aabbdcef6e016978a3132045281dfbd51c69792` |
| modelcontextprotocol/ext-apps | `82221c0c8ce7661efa6771c9d461511b1650495f` |
| taylorwilsdon/google_workspace_mcp | `25dc59d7e045c79b3f60a40782d071a664562c86` |
| twentyhq/twenty | `0b15ef25be30229026e4e785eca36314298ebfcc` |
| ivnvxd/mcp-server-odoo | `4c287099cedf23f2ad9f4635ee6a7451c89c5997` |
| WordPress/mcp-adapter | `54ed266a8c46b71fdb8e5b8a7d35668f90fb8994` |
| cyenis/holded-mcp | `c90aad39086a7291b6eca7f6edb2355318edabeb` |
| microsoft/wassette | `3a413e3869b95a1b681c5c9bc055b357b2f348b4` |
| openai/mcp-extensions | `ca16cb3bc015baaa1b849082d8755bbef18770cb` |

## 7. Entrega y límites

Se añade este informe y se enlaza desde la propuesta de arquitectura. Sin nuevas
dependencias, ejecución de herramientas externas, cambios de kernel, nuevos envíos
ni cambios de visibilidad del repo. Compatibilidad y rendimiento en 16/24 GB
siguen pendientes de pruebas. Suite no ejecutada: cambios documentales únicamente.
