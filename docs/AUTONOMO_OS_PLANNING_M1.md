# M1 — planificación durable del workflow de email

## Entregado

- Se reutiliza `LlamaCppProvider` y el kernel/journal de tareas existentes.
- Catálogo semántico `email-lead-v1` definido por el host: identificar → CRM → proponer lead → clasificar → borrador → revisión → envío → interacción → seguimiento.
- Validación estructurada estricta de acciones, orden, slots y parámetros vacíos. El modelo no define recursos reales, URL, credenciales ni destinatarios.
- Una planificación simultánea por proceso; deadline local de 30 segundos. Respuestas tardías no escriben el plan.
- Persistencia atómica de PlanningStarted y PlanCommitted en una transacción del journal. Durante inferencia no se escribe un estado intermedio que necesite recuperación de un efecto.
- Repetir la solicitud una vez registrado el plan no vuelve a invocar el modelo.
- Auth/tenant/owner/rol antes de inferencia y comprobación de sesión antes de commit.
- UI con botón de planificación, pasos/versiones reales y recarga. Se conserva UNKNOWN.
- Provider HTTP local rechaza redirecciones, userinfo, rutas y query overrides.
- Corrección de login cuando solo cambia el hash: ahora recarga después de guardar sesión para iniciar lectura autenticada.
- Perfil de equipo visible actualizado a M4 24 GB; elección de modelo queda pendiente de benchmark.

## API

`POST /v1/workspaces/<tenant>/runtime/<task>/plan`

Body exclusivo: `{"workflow":"email-lead-v1"}`. Bearer autenticado. Owner/agent pueden planificar sus tareas; worker/reviewer no. 201 primer plan, 200 repetición confirmada, 409 concurrencia/cambio de estado, 400 propuesta no confirmada, 401 sin sesión/revocada, 404 tarea ajena/inexistente.

No se acepta JSON de un plan proporcionado por el navegador. No se acepta un campo approved/owner/URL/recipient. La UI no obtiene credenciales del modelo.

## Configuración local

Se reutilizan `LLAMA_BASE_URL` (default `http://127.0.0.1:8080`), `LLAMA_MODEL` y `LLAMA_API_KEY`. Solo endpoint HTTP loopback. No se instaló llama-server, Ollama ni un modelo en esta entrega. Sin servicio disponible, el plan falla explícitamente y la tarea sigue sin plan. El cliente permite 40 segundos para la operación de planificación.

## Límites importantes

Este primer planner es un workflow restringido: el modelo debe proponer la secuencia admitida. No es un planificador general que descomponga cualquier objetivo. El botón elige explícitamente el workflow de email.

Los IDs `email.incoming`, `email.reply`, `crm.local` son **slots del workflow**, todavía no recursos de ejecución registrados. Las constraints expresan requisitos futuros; no equivalen a una decisión C8/C9 tomada ni a permiso concedido.

Los verificadores business/custom declarados todavía no están registrados. No hay scheduler ni dispatch activado: el plan listo no puede enviar correo ni cambiar CRM. Falta conectar datos reales, policy, presupuesto, aprobación de contenido exacto y C11. Un plan solo muestra pasos, sin borrador generado ni email ya procesado.

No se han reescrito los efectos PYMES ni se ha activado su worker para este workflow. Su deuda de UNKNOWN permanece documentada en la auditoría.

La API admite un primer plan. Edición/replanning/versiones posteriores requieren una entrega separada con invalidación de aprobaciones y semántica de unidades históricas.

## Verificación

Tests añadidos de persistencia/reopen, owner/tenant/role, entrada maliciosa, revisión obligatoria/orden, deadlines, late response, revocación/cancelación durante inferencia, cliente HTTP y SIGKILL durante inferencia/después del commit. Tests del proveedor comprueban que no se sigue un redirect.

Prueba visual: API real/journal SQLite y cliente real, con **servidor de inferencia simulado en loopback**. Click en plan y recarga conservan 9 pasos/version 1. No acredita calidad de un modelo real ni un envío real. Captura `/tmp/autonomo-os-plan-2026-10-03.png`.

## Próximo milestone

Vista completa del plan y decisión de policy/approval vinculada a versión/hash y a contenido/recipient del host. Después conectar esa aprobación a Governed Runner con los stores durables necesarios. Ningún envío externo hasta cerrar esa cadena y sus pruebas de respuesta perdida/reconciliación.

## Resultado final registrado

Suite completa: 676 tests, 675 pasan, 0 fallan, 1 omitido opcional. Typechecks y builds de workspaces pasan. Los 18 tests dirigidos de planner/provider pasan.

Logs: `/tmp/autonomo-plan-release-tests.log`, `/tmp/autonomo-plan-release-types.log`, `/tmp/autonomo-plan-release-build.log`. Cambios conservados en el árbol de trabajo; no se creó un commit que mezclase esta entrega con el amplio V2 preexistente sin commit.
