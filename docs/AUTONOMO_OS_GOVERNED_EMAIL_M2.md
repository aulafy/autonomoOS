# Autónomo OS — M2: email simulado gobernado

Fecha: 2026-10-03. Repositorio: `/Users/mac/Downloads/agent-world-os`.

## Resultado y alcance

M2 implementa el ciclo de aprobación y envío simulado sobre C1–C12 y el task runtime AW2. El único dispatch externo del workflow entra por el `GovernedActionRunner` existente. No hay envío directo desde UI ni uso del worker legacy de PYMES para este ciclo.

Los nueve pasos de `email-lead-v1` se proyectan en el kernel de tareas con intentos, dependencias, artefactos persistidos y verificaciones. Identidad, CRM, clasificación y borrador usan **fixtures del host**. La clasificación no es inferencia sobre un mensaje real, y los registros CRM y el seguimiento son artefactos simulados del journal, no cambios en Holded ni en un CRM de clientes. La planificación M1 conserva el proveedor de inferencia local y su validación del template.

**Gmail/M3 no se ha implementado ni conectado.** No hay OAuth, tokens Gmail ni emails reales. FakeEmailProvider solo acepta direcciones `@example.test` y no tiene acceso de red.

## Arquitectura y archivos

- `pymes/src/email-provider.ts`: contrato `EmailProvider` (`prepare`, `send`, `observe`, `reconcile`), validación estricta y buzón SQLite simulado independiente.
- `pymes/src/email-review-store.ts`: revisiones, decisiones inmutables, políticas, artefactos y auditoría, persistidos mediante JournalKernel.
- `pymes/src/email-governance.ts`: adapter sobre C11; contratos, recursos, autoridad, presupuesto, resource lease/fencing, C8, C9, observación, reconciliación y C12.
- `pymes/src/email-task-bridge.ts`: verifica los artefactos de la simulación y proyecta la evidencia del efecto en AW2. No invoca el proveedor de email ni implementa otro executor.
- `pymes/src/email-workflow.ts`: coordina revisión y ciclo del job; serializa operaciones y evita readmitir efectos existentes, incluidos UNKNOWN y fallidos.
- `pymes/src/runtime-source.ts`: registra todos los stores antes del replay, configura el proveedor y recupera C12 antes de aceptar dispatch.
- `pymes/src/workspace-api.ts`, `workspace-client.ts`, `email-view.ts`: API autenticada, permisos, aislamiento por propietario/tenant y validación del DTO.
- `pymes/src/runtime-screen.ts`, `runtime-screen.css`, `main.ts`: payload exacto, decisiones, progreso, evidencias y recuperación; la sincronización de la bandeja conserva el formulario y la selección del runtime.

## Vínculo de aprobación

SHA-256 sobre JSON canónico. El plan incluye job, propietario, objetivo, versión y definición inmutable de todos sus pasos. El payload incluye From, To, Cc, Bcc, Subject, Body y contacto.

`bindingHash = SHA256({taskId, owner, planVersion, planHash, stepId, payloadHash})`.

La decisión persiste usuario, fecha, decisión, review y bindingHash. C8/C9 reciben IDs de intent/sink/plan derivados de ese vínculo. El runtime revalida la revisión y la sesión antes del commit gate y antes del executor. Un cambio en el payload del request o en el plan invalida la ejecución. Rechazar no elimina el job ni puede transformarse después en aprobar esa misma revisión.

El presupuesto limita a un envío por vínculo y reserva los bytes del payload. La aprobación y la autoridad caducan en una hora; no se renuevan silenciosamente para volver a enviar. Los leases y las reservas de dispatch tienen duración de 30 segundos. El gate conserva las validaciones originales.

## UNKNOWN y recuperación

El buzón simulado persiste el side effect en SQLite WAL/FULL **antes** de devolver respuesta. Un error posterior produce UNKNOWN; éxito declarado sin observación también permanece UNKNOWN.

Reconciliar solo consulta el buzón y valida idempotency key y hash exacto. No llama a `send`. Si la evidencia falta, conserva UNKNOWN y respeta el backoff/agotamiento de C7. No existe retry automático del envío.

C12 convierte `dispatching` abandonado en UNKNOWN y prepara la consulta. Un efecto `prepared` abandonado se cierra como fallo certificado antes del dispatch, liberando recursos. La decisión y el plan se conservan.

C6 conserva su estado histórico UNKNOWN después de reconciliar. C7 añade `confirmed_effect`, y `resolveEffectiveEffectOutcome` produce `committed`. La UI muestra ambos y el job AW2 completa sus pasos restantes únicamente tras esa evidencia. El presupuesto retenido se repara mediante el mecanismo existente.

## API

Base: `/v1/workspaces/<tenant>/runtime/<task>/email`.

| Método/ruta | Contenido | Permiso |
|---|---|---|
| GET base | Estado, review, decisión, políticas, efectos, evidencia y auditoría | readRuntime |
| POST /review | `{}` | createRuntimeTask |
| POST /decision | `{bindingHash, decision: "approved" / "rejected"}` | approveOffer |
| POST /execute | `{}` | executeEffect |
| POST /reconcile | `{}` | createRuntimeTask |

Todas las rutas comprueban propietario y tenant. GET no puede ejecutar una operación. No se permite que el cliente sustituya parámetros del email al ejecutar. Una simulación no configurada devuelve 404 explícito.

## Activación local

En el proceso API, `PYMES_FAKE_EMAIL_ENABLED=1` activa el proveedor simulado. Por defecto está desactivado.

`PYMES_RUNTIME_DB_PATH` selecciona el journal (default `./data/pymes-task-runtime.db`). El buzón simulado está en `<runtime-path>.fake-email.db`. Incluir ambos y sus WAL en backups coordinados. No usar un journal legacy de H1 como journal de producto. Modelo operativo de M2: un proceso API propietario del journal, no múltiples procesos de escritura independientes.

En Centro de agentes: crear trabajo → preparar plan → evaluar envío simulado → revisar campos → aprobar/rechazar → ejecutar → consultar evidencia. UNKNOWN ofrece únicamente consulta/reconciliación y actualización.

## Verificación realizada

- Suite completa: **696 pruebas, 695 pasan, 0 fallos, 1 omitida** (integración Orca opcional).
- **20 pruebas nuevas de M2**: bindings y cambios de payload, persistencia, rechazo, permisos/ownership, sesión revocada, cancelación, grant revocado, budget congelado, emergency stop, éxito sin observación, forward compatibility y recorrido de producto.
- Cinco procesos hijos terminados realmente mediante **SIGKILL**: tras approval, antes de dispatch, tras marker/durante dispatch, tras persistir side effect antes del commit, y tras perder la respuesta/UNKNOWN.
- En los casos con side effect, reconciliación y llamadas repetidas a execute/reconcile conservan **1 correo y 1 llamada a send**. Sin side effect y sin certificado suficiente, se mantiene UNKNOWN.
- `npm run typecheck --workspaces --if-present`: pasa.
- `npm run build`: pasa.
- Prueba visual en navegador: creación y plan → 5 pasos ficticios verificados → review exacto → aprobación → envío → 9/9 y objetivo global comprobados.
- Segundo recorrido visual: respuesta perdida → UNKNOWN/6 de 9 → SIGKILL del API QA → reinicio → UNKNOWN conservado → botón de reconciliación → committed efectivo y 9/9.
- Buzón QA final: **2 correos y 2 llamadas**, un correo por cada recorrido. Capturas: `/Users/mac/Downloads/AUTONOMO_OS_M2_EMAIL.png` y `/Users/mac/Downloads/AUTONOMO_OS_M2_RECONCILIATION.png`.
- El servidor de inferencia del QA devuelve respuestas sintéticas para probar el contrato; esto no constituye un benchmark ni una prueba de calidad de un LLM real.

Logs de verificación: `/tmp/autonomo-m2-suite-final.log`, `/tmp/autonomo-m2-types-final.log`, `/tmp/autonomo-m2-build-final.log`.

## Límites y siguiente hito

M2 demuestra seguridad y durabilidad del **workflow simulado**. No acredita todavía la utilidad comercial con mensajes/CRM reales, calidad de redacción, entrega real, OAuth/Keychain, rendimiento en el Mac mini ni instalación completa para un cliente.

M3 queda reservado a Gmail API, OAuth desktop con callback loopback, secretos fuera de logs y audit (Keychain a evaluar), procesamiento local y sync incremental con historyId. Su observador deberá demostrar evidencia real del proveedor; el recibo Fake no se puede reutilizar como evidencia Gmail.

## Historial de cambios

- `3699149`: snapshot del baseline AW2 que ya existía sin commit, recuperado del backup anterior a M1; verificados los 138 ficheros fuente byte a byte. El archivo BASE_COMMIT.txt del ZIP es metadata del backup y no se incorpora al proyecto.
- `1b43375`: contrato de email, decisiones durables y adapter C11 con pruebas del núcleo.
- La integración M1/M2 de API, task runtime, UI, SIGKILL y esta documentación se registra en el commit siguiente.
