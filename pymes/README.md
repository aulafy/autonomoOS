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
Los nombres y mensajes son ficticios. WhatsApp, Telegram,
iMessage, correo, CRM y calendario aparecen como fuentes y destinos previstos;
**aún no hay conexiones reales**.

La clasificación local puede probarse **solo con los mensajes ficticios**:

```bash
npm run pilot:classify --workspace=@agent-world/pymes -- msg-1
npm run pilot:evaluate --workspace=@agent-world/pymes
```

Requiere Ollama en `127.0.0.1:11434` con `llama3.2:3b` cargado, o un modelo
local indicado mediante `PYMES_LOCAL_MODEL`. La salida es una propuesta no
aceptada y no actualiza la demo. Véase [evaluación del modelo](MODEL_EVALUATION.md).

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
