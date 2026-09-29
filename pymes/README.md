# PYMES · agente de trabajo para seguros

Esta carpeta inicia un producto vertical para una agencia o correduría de
seguros. El problema inicial es la primera hora de cada mañana: mensajes
dispersos, incidencias, solicitudes de propuesta, renovaciones, citas y cambios
en expedientes. El primer prototipo convierte un conjunto ficticio de mensajes
en una bandeja priorizada, borradores y una agenda de solo lectura.
Los mensajes sin contacto reconocido permanecen en la bandeja como casos
pendientes de identidad; no reciben un borrador personalizado ni ficha CRM.

El piloto está configurado para España y cubre coche, vida, hogar y
responsabilidad civil para autónomos. Holded es el CRM de referencia y Google
Calendar el calendario previsto. Ambos siguen **sin conexión real**.

## Ver el prototipo

Desde la raíz del repositorio:

```bash
npm install
npm run demo:pymes
```

Abrir `http://127.0.0.1:5174/`. Se puede filtrar por canal, buscar un contacto,
revisar el contexto CRM y marcar un borrador para revisión. Todo se queda en la
sesión del navegador. La cola permite volver a los casos marcados; los mensajes
sin identidad se añaden automáticamente. Cada caso muestra una ficha de
preparación de llamada con preguntas pendientes y, cuando existe, la próxima
cita del cliente. El operador puede corregir intención y ramo con un motivo;
la prioridad de una incidencia comunicada no baja solo por cambiar su etiqueta.
Las solicitudes de propuesta tienen una ficha por ramo para marcar datos
preliminares verificados durante esta sesión. Si la identidad no está vinculada,
las casillas se bloquean. Para vida, el cuestionario de la aseguradora se
muestra como paso externo y esta demo no recoge datos de salud. Completar la
ficha no equivale a obtener una cotización: faltan tarifador, condiciones y
revisión de una oferta real.
Los nombres y mensajes son ficticios. WhatsApp, Telegram,
iMessage, correo, CRM y calendario aparecen como fuentes y destinos previstos;
**aún no hay conexiones reales**.

## API local de workspace

La primera API de PYMES se puede ejecutar con un token de desarrollo explícito:

```bash
PYMES_API_BOOTSTRAP_TOKEN='cambia-este-token-en-desarrollo' npm run api --workspace=@agent-world/pymes
```

Expone `GET /v1/workspaces/:tenant/inbox` y
`POST /v1/workspaces/:tenant/approvals`. El token de arranque no es un sistema
de autenticación de producción; la siguiente fase lo sustituirá por sesiones y
persistencia de servidor. El servidor no arranca sin un token de al menos 16
caracteres.

El ingress interno de OpenClaw Enterprise se activa por separado con
`PYMES_OPENCLAW_INGRESS_TOKEN` y listas de agente, recurso, canales, remitentes
emparejados y conversaciones consentidas. Publica en
`POST /v1/workspaces/:tenant/ingress/openclaw` usando el header
`X-PYMES-Ingress-Token`; la política no se acepta dentro del cuerpo del evento.

La cola de revisión y las ofertas transcritas se guardan ahora en un almacén
versionado del navegador para no perder el trabajo al recargar. Sigue siendo
almacenamiento local de la demo, no persistencia multiusuario: el producto real
lo sustituirá por la API autenticada y la base de datos del tenant.

La clasificación local puede probarse **solo con los mensajes ficticios**:

```bash
npm run pilot:classify --workspace=@agent-world/pymes -- msg-1
npm run pilot:evaluate --workspace=@agent-world/pymes
```

Requiere Ollama en `127.0.0.1:11434` con `llama3.2:3b` cargado, o un modelo
local indicado mediante `PYMES_LOCAL_MODEL`. En la interfaz, abre «Revisar
intención y ramo» y pulsa «Proponer con modelo local». La propuesta puede
copiarse al formulario, pero no se guarda sin un motivo escrito por el
operador. La ruta del servidor acepta únicamente los ocho IDs ficticios; la
salida no actualiza automáticamente el caso. Véase
[evaluación del modelo](MODEL_EVALUATION.md).

![Resumen de PYMES](demo-overview.jpg)

## Primer flujo completo que construiremos

1. Ingerir mensajes con identificador de origen, hora, canal y consentimiento
   aplicable; detectar duplicados sin fusionar conversaciones distintas.
2. Asociar el mensaje con un contacto o pedir revisión si la identidad no es
   clara. Guardar procedencia y clasificar intención y urgencia.
3. Preparar un resumen matinal, una siguiente acción y un borrador. Para una
   propuesta de seguro, recoger datos y consultar productos autorizados antes
   de mostrar primas o condiciones.
4. Presentar al agente humano un punto de revisión. Solo tras su aprobación
   enviar respuestas, crear citas o actualizar el CRM.
5. Observar la respuesta del proveedor y registrar confirmación o estado
   incierto; reconciliar antes de repetir una escritura.

La [arquitectura de integración](ARCHITECTURE.md) conecta este flujo con los
controles C1–C12 de Agent World OS. El primer piloto real necesitará validar
las cuentas y canales accesibles mediante conectores autorizados. Véase
también el [estado de los canales](INTEGRATIONS.md), en
especial la diferencia entre iMessage personal y Messages for Business.
