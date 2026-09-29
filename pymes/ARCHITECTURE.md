# Arquitectura inicial de PYMES

## Límite del primer prototipo

`src/domain.ts` es una proyección de planificación. Recibe mensajes y agenda,
elimina duplicados por `(canal, id de origen)`, asocia contactos, ordena casos y
prepara borradores. La clasificación de los datos de muestra está etiquetada
como `demo_fixture`: no se presenta como una inferencia de IA. La función no
posee ningún cliente de red ni método de envío. `src/main.ts` solo muestra
esa proyección y permite marcar borradores para revisión en memoria local.
Si falta un contacto o el ID no existe, el mensaje se conserva con identidad
pendiente, prioridad elevada y un borrador bloqueado para envío. Solo una
verificación humana puede convertirlo en una asociación de expediente.

`src/call-plan.ts` prepara un guion de llamada a partir del caso y de la agenda
local. Un caso sin identidad no hereda citas de otro contacto. La interfaz
mantiene una cola de revisión en memoria durante la sesión; añade
automáticamente los casos sin identificar y permite abrir desde ella los casos
marcados. Esta cola no significa aprobación, envío ni llamada realizada.

`src/classification.ts` valida propuestas con un vocabulario cerrado de
intenciones y ramos. Una propuesta de modelo no altera mensajes; la aceptación
del operador exige un motivo y fecha y solo cambia la clasificación local.
La señal `reportedIncident` procede del mensaje inicial y sigue elevando la
prioridad aunque alguien corrija la etiqueta `topic`. La demo no invoca aún un
modelo para clasificar mensajes reales.

`src/local-classifier.ts` llama a la [API local de Ollama](https://github.com/ollama/ollama/blob/main/docs/capabilities/structured-outputs.mdx)
con salida estructurada y solo admite una URL HTTP de loopback. El comando
`pilot:classify` selecciona un ID de los datos ficticios y nunca toma texto
libre del usuario; `pilot:evaluate` repite el conjunto de ejemplos y un caso
adversarial. `vite.config.ts` añade una ruta de desarrollo que solo acepta
`POST /api/demo-classify/msg-1` a `msg-8` desde el origen de la demo. La ruta
lee el texto fijo del servidor y devuelve una propuesta no aceptada. La UI
puede copiarla al formulario, pero sigue exigiendo un motivo para aceptar la
clasificación. La clasificación de mensajes reales necesitará pasar por los
controles de flujo de información C9 y por el límite de aceptación humana.

`src/connectors.ts` añade dos operaciones de lectura independientes de la UI:
búsqueda exacta de un contacto en Holded por teléfono y listado acotado de
eventos con hora en Google Calendar. Reciben credenciales desde un llamador
de servidor; no las almacenan ni las incluyen en la URL. Devuelven modelos
externos sin asociarlos automáticamente con una persona del CRM. Calendar
recorre páginas con un límite de diez y conserva tanto citas con hora como
eventos de día completo; un límite superado falla sin devolver un resultado
parcial. No hay flujo OAuth, almacén de tokens ni cuentas conectadas en esta
versión.

`src/integration-view.ts` prepara el enlace de esas lecturas con la bandeja.
Solo acepta asociaciones explícitas entre IDs externos e IDs locales,
registradas con persona y fecha de verificación. Ni el nombre del contacto ni
el título de la cita se usan para asociar identidades. Los registros sin
vínculo permanecen pendientes y los vínculos duplicados o incompletos fallan.

## Integración prevista con el kernel

| Paso | Recurso/control | Resultado exigido |
| --- | --- | --- |
| Leer un canal | C2 recurso de bandeja, C9 flujo de datos | Mensaje con origen y permisos comprobados |
| Asociar identidad | C1 sesión, CRM de solo lectura | Coincidencia verificable o revisión humana |
| Clasificar y redactar | H3 inferencia local, C8 composición | Propuesta trazable, sin autoridad propia |
| Cotizar | Catálogo y tarifador registrados | Datos completos; precio y cobertura provenientes del proveedor |
| Enviar mensaje | C11 control, C6 efecto, C5 observación | Aprobación humana, idempotencia y entrega confirmada |
| Crear cita o cambiar CRM | C11, C6, C7 reconciliación | Escritura autorizada y verificada; sin reintento ciego |

## Reglas del producto

- Los mensajes, documentos de pólizas y datos de clientes son sensibles. La
  interfaz de operador debe mostrar solo lo necesario para el trabajo.
- Una clasificación o un borrador nunca constituyen aprobación. El humano
  decide antes de enviar, modificar una póliza, cotizar o reservar una cita.
- No se fabrican primas, coberturas, exclusiones ni condiciones contractuales.
  Una propuesta requiere datos verificados y respuesta de un producto autorizado.
- Si un proveedor deja incierta una escritura, el sistema consulta su estado
  antes de repetirla. La respuesta del ejecutor no basta como prueba.
- Cada conector real necesita revisión de acceso, trazabilidad, retención y
  reglas de tratamiento de datos del país y de la agencia antes del piloto.

## Orden recomendado de implementación

1. Importación de correo y calendario en un entorno de prueba, de solo lectura.
2. Identidad/contactos y bandeja diaria con corrección humana de clasificación.
3. Borradores y aprobación explícita dentro de PYMES.
4. Una escritura gobernada: crear o actualizar una actividad en el CRM y
   comprobar su resultado.
5. Respuesta a un canal autorizado, con pruebas de idempotencia y fallo ambiguo.
6. Propuestas conectadas a datos de producto y tarifadores verificables.

La disponibilidad y condiciones de conectores de WhatsApp, Telegram e iMessage
deben verificarse para los sistemas concretos de la agencia. El prototipo no
asume acceso a cuentas personales ni a conversaciones existentes.

`src/openclaw-gateway.ts` es un adaptador opcional para un gateway OpenClaw.
Adopta la idea de un único punto de entrada para canales, pero conserva la
frontera PYMES: solo acepta canales permitidos, remitentes emparejados y
conversaciones con consentimiento registrado. El evento entra con intención
`unknown`, sin `contactId` y con `classificationSource: connector`. El gateway
no puede aprobar, cotizar, modificar el CRM ni enviar mensajes desde este
adaptador.

`src/workspace-policy.ts` es la política común de tenant y roles. El propietario
puede administrar la agencia y ejecutar efectos; un agente prepara trabajo pero
no aprueba ni ejecuta; un revisor aprueba y exporta, pero no administra
conectores. Las aprobaciones guardan actor, tenant, recurso, motivo, fecha y
hash del borrador para que la API futura y OpenClaw Enterprise no dupliquen
reglas distintas.
