# Auditoría inicial — Autónomo OS

3 de octubre de 2026. Repo `/Users/mac/Downloads/agent-world-os`, rama `codex/h4-http-api`, HEAD `59aacf6`. V2 del handoff más reciente define el objetivo: Mac mini M4 24 GB, desarrollo en Air M4 24 GB, IA/CRM/datos principales locales. Email primero; WhatsApp después. No instalar modelos para cerrar esta entrega.

## Alcance y evidencia

Inspeccionados árbol de HEAD, inventario de paquetes/apps/scripts/tests, wiring de runtime/SQLite/runner/proveedores/UI y diferencias del árbol de trabajo. Se revisan las garantías mediante código y suite completa; esto no es una certificación de seguridad ni prueba con cuentas de cliente. Los commits H1/H1.1/H2/H3/H4 citados son antecesores de HEAD (comprobación `git merge-base --is-ancestor`).

Baseline del árbol de trabajo antes de cambios: 661 tests, 660 pasan, 0 fallos, 1 omitido; typecheck y build pasan. No atribuir esa cifra al HEAD limpio: paquetes V2 y cambios de UI/API siguen sin commit. Snapshot de los cambios preexistentes: `/Users/mac/Downloads/agent-world-os-before-autonomo-planning-2026-10-03.zip`.

## Clasificación

| Componente | Estado | Evidencia / límite |
|---|---|---|
| C1 SessionContract | HECHO | `packages/contracts`; store/validación y tests |
| C2 ResourceRegistry | HECHO | `packages/resources`; resolución canónica y generaciones |
| C3 leases/fencing | HECHO | `packages/leases`; revalidación en commit gate y tests |
| C4 budgets | HECHO | `packages/budgets`; reserva/commit/hold durable |
| C5 observation | HECHO | `packages/observation`; fuente independiente y política |
| C6 effects | HECHO | `packages/effects`; dispatch marker y settlement |
| C7 reconciliation | HECHO | `packages/reconciliation`; lectura y evidencia |
| C8 composition | HECHO | `packages/composition-policy`; historial/aprobaciones |
| C9 information flow | HECHO | `packages/information-flow`; working sets/releases |
| C10 supervision | HECHO | `packages/supervision`; emergency stop/quarantine |
| C11 Governed Runner | HECHO | `packages/control-plane`; gates antes del executor |
| C12 recovery | HECHO | `packages/recovery`; bootstrap/read-only/UNKNOWN |
| H1 SQLite | HECHO | `runtime-store-sqlite`; journal/digests, SIGKILL |
| H2 filesystem | HECHO | Executor/observer/reconciler reales + crash tests |
| H3 local inference | HECHO | `LlamaCppProvider`, H3 goal service; no live modelo en esta auditoría |
| H4 HTTP restringido | HECHO | Host controla API, observación GET y crash tests |
| Integración C1–C12/H1–H4 en app original | HECHO | `apps/agent-runtime/src/demo-control-plane.ts`; suite de integración |
| V2 global tasks/providers/context/ledgers | PARCIAL | Código y pruebas presentes en árbol de trabajo; faltan ciclo completo y aceptación real |
| SQLite de trabajos PYMES | HECHO | Tenant binding + task commands, restore fail-closed |
| Todos los ledgers/C12 en journal del producto | NO ENCONTRADO | `runtime-source.ts` registra solo binding y task runtime |
| UI/cliente de trabajos | PARCIAL | Auth, lectura, creación, estados y detalle parcial; falta plan→ejecución |
| Auth producto | PARCIAL | Token hash, tenant/roles/revocación; onboarding/expiración profesional pendientes |
| Aprobación de ofertas/efectos PYMES | PARCIAL | Contrato propio; aún no es aprobación de plan conectada a C8/C9/C11 |
| Worker de efectos PYMES | DEUDA TÉCNICA | Dispatcher independiente; excepciones se convierten en failed |
| CRM local profesional | PARCIAL | Datos demo y almacenamiento de casos/efectos; sin entidad completa de lead/contacto/interacción/seguimiento |
| Email oficial end-to-end | NO ENCONTRADO | Canal genérico de gateway no es Gmail/OAuth ni envío observado |
| Hoy | PARCIAL | Pantalla de demo; no agregado completo de fuentes reales |
| WhatsApp oficial | PARCIAL | Webhook/firmas/consentimiento; cuenta/piloto real pendiente |
| Embeddings locales / FTS CRM | NO ENCONTRADO | No necesarios para el primer plan durable |
| Instalación comercial | PARCIAL | Scripts de diagnóstico/UI/launchd/backups; falta entrega/reinicio/restore integral |

HECHO significa componente implementado y probado en su alcance, no flujo comercial completo.

## Diferencias con documentos

- Hardware y local-only ahora son decisiones cerradas; Holded pasa de CRM objetivo a integración opcional futura: el CRM principal debe ser local.
- El HEAD limpio no contiene los paquetes V2 nuevos ni la creación de trabajos actual. La base funcional actual incluye untracked y modificaciones.
- Crear una tarea no inicia planner/runner. El criterio human-approval no es permiso de envío.
- C11/H4 existen e integran en la app original; PYMES usa otro dispatcher que no hereda esas garantías.
- `UNKNOWN` existe en kernel/cliente, pero el tipo de efectos PYMES solo admite pending/confirmed/succeeded/failed.
- Inferencia canónica compatible con llama-server ya existe; Ollama es un clasificador demo adicional, no hay que desplegar dos servidores.
- No se confirma Kokoro ni todos los modelos citados por un handoff. Sus recomendaciones no prueban instalaciones.
- La numeración V2 es AW2-8 scheduler, AW2-9 planner, AW2-12 recovery matrix.

## Riesgos P0 para el workflow

1. Enviar desde el worker PYMES puede convertir una respuesta perdida en failed y habilitar retry. El workflow nuevo deberá usar Governed Runner/effects/reconciliation existentes.
2. No existe unión durable de plan, aprobación exacta, ejecución y evidencia en producto; un plan listo no debe conceder autoridad.
3. El provider local existente permitía seguir redirecciones HTTP: el próximo cambio debe impedir que un endpoint local derive inferencia a un servidor externo.
4. Identidad/recursos/destinatario del correo deben venir de bindings del host. El modelo no puede inventarlos.
5. El journal del producto no registra aún C12/ledgers completos; no reutilizar bases legacy incompatibles ni simular persistencia integral.

## Entregas mínimas propuestas

1. **Plan durable:** catálogo semántico del workflow email, propuesta mediante provider local existente, validación estricta, WorkUnits en el journal actual, API autenticada. Cero dispatch/aprobación concedida. Probar respuestas maliciosas, aislamiento, concurrencia, reinicio e idempotencia.
2. **Plan/policy/aprobación:** exposición de intención, recursos, versión/hash, costes/límites; decisión C8/C9; aprobación ligada al plan y contenido exactos, nunca autoaprobación del modelo.
3. **Runner durable:** registrar stores necesarios, authority/budget/leases del host, conexión C11, progreso/detail UI, UNKNOWN/recovery. Crash tests antes de activar escritura real.
4. **CRM local + email:** entidades mínimas y conector oficial del proveedor elegido, borrador/recipient fijado, envío observado/reconciliable, interacción/seguimiento transaccionales.
5. **Aceptación vertical:** navegador y E2E email→CRM→plan→approval→send→followup→audit, reinicio/SIGKILL, benchmark e instalación reproducible. Hoy después; WhatsApp posterior.

Los commits deben separar el snapshot preexistente de cada entrega nueva. No incluir cambios anteriores como si pertenecieran a un milestone nuevo.

## Decisión pendiente que afecta al conector

Proveedor de email del primer piloto: Gmail, Microsoft 365 o IMAP/SMTP. El plan durable y gobierno se pueden completar antes de elegirlo. No se necesitan credenciales reales para sus tests.

## Actualización tras M1

Se ha implementado planificación restringida `email-lead-v1`, persistencia atómica, endpoint autenticado y botón/plan real en UI; ver `AUTONOMO_OS_PLANNING_M1.md`. Se cerró la redirección del provider y se corrigió el login que no reiniciaba la lectura al cambiar solo el hash. Perfil visible actualizado a 24 GB.

Se confirmó el plan en navegador tras recarga **y tras reiniciar la API QA**, usando inferencia simulada local y SQLite real. Hay pruebas nuevas de SIGKILL durante inferencia y después del commit. No equivale a una validación de modelo real, CRM ni correo real. El flujo plan→policy→approval→C11 sigue pendiente.
