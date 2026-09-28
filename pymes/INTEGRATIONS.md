# Canales e integraciones: punto de partida

La bandeja del prototipo usa datos ficticios. La presencia de un canal en la
interfaz no implica que podamos leer una cuenta personal existente. Cada piloto
debe comprobar producto, titularidad de la cuenta, permisos y modalidad de
integración antes de incorporar conversaciones reales.

| Canal | Vía documentada | Decisión para el piloto |
| --- | --- | --- |
| WhatsApp | [WhatsApp Business Platform](https://whatsappbusiness.com/developers/developer-hub/) ofrece números de prueba y webhooks. | Evaluar una cuenta empresarial autorizada; no asumir acceso a WhatsApp personal. |
| Telegram | [Bot API](https://core.telegram.org/bots/api) recibe actualizaciones del bot mediante webhook o `getUpdates`. | Probar un bot o conexión empresarial consentida; no asumir lectura de todos los chats personales. |
| iMessage | [Messages framework](https://developer.apple.com/documentation/messages) documenta extensiones y aplicaciones dentro de Messages; [Messages for Business](https://support.apple.com/en-gb/guide/security/sec1c603aab4/web) es un servicio distinto para conversaciones con empresas. | Tratar la bandeja iMessage personal como requisito sin conector confirmado. Estudiar Messages for Business o un proveedor autorizado si el caso lo permite. |
| Correo | Depende del proveedor concreto de la agencia. | Elegir una cuenta de prueba autorizada antes de integrarlo. |
| Google Calendar | [Calendar API](https://developers.google.com/workspace/calendar/api/auth) documenta OAuth y el alcance `calendar.events.readonly`. | Integrar primero citas en solo lectura, con autorización de la cuenta. La agenda actual es ficticia. |
| Holded | [API de contactos](https://developers.holded.com/reference/list-contacts-1) y [API de CRM](https://developers.holded.com/reference/create-lead-1). | Preparar lectura de contactos y vinculación de identidades. No escribir leads o expedientes todavía. |

## Elección de CRM

Holded es el valor inicial porque [su oferta para autónomos en España](https://www.holded.com/es/autonomos)
incluye CRM y gestión administrativa, y dispone de API documentada. No hemos
encontrado una clasificación independiente reciente que confirme que sea **el
CRM más utilizado por autónomos en España**; esa posición no se afirma aquí.
Si la agencia ya usa un sistema especializado como
[ebroker CRM 360](https://www.ebroker.es/funcionalidades/crm-360/), el conector
debe adaptarse al sistema existente en lugar de crear una segunda ficha maestra.

El orden de integración se decidirá con la agencia. Para el primer piloto,
conviene empezar por una fuente que permita acceso de prueba autorizado y una
salida cuyo resultado pueda observarse. La propuesta, la respuesta al cliente
y cualquier cambio en CRM o calendario quedan sujetos a aprobación humana y a
los controles de Agent World OS.

## Lecturas implementadas

`src/connectors.ts` contiene clientes HTTP de solo lectura. Holded consulta
`GET /api/invoicing/v1/contacts` con coincidencia exacta en `phone` y `mobile`,
eliminando duplicados por ID; Google
Calendar consulta `GET /calendar/v3/calendars/{id}/events` con una ventana
temporal, eventos recurrentes expandidos y un máximo de 100 por página. Una respuesta con
otra página se consulta hasta un límite de diez; los eventos de día completo
se conservan. Si se supera el límite, la lectura falla sin resultado parcial.
Los tests usan respuestas simuladas;
no se han usado cuentas ni datos reales. Para conectarlos hace falta un proceso
de servidor que obtenga y proteja la clave de Holded y un token OAuth con
`calendar.events.readonly`, además de decidir qué calendario y qué contactos
puede consultar el agente.

El siguiente límite ya está modelado en `src/integration-view.ts`: una lectura
de Holded o Calendar no equivale a una identidad confirmada. Cada enlace al
contacto local requiere IDs explícitos, operador y fecha de verificación; los
resultados ambiguos permanecen sin vincular. Los ejemplos y tests no conceden
permisos ni crean citas.

## Prueba local de lectura

El comando siguiente se ejecuta en Node, fuera del navegador. Devuelve solo
recuentos; no imprime nombres, teléfonos, títulos ni credenciales.

```bash
PYMES_HOLDED_API_KEY=... npm run pilot:read --workspace=@agent-world/pymes -- holded +34600111222
PYMES_GOOGLE_ACCESS_TOKEN=... PYMES_GOOGLE_CALENDAR_ID=primary \
  npm run pilot:read --workspace=@agent-world/pymes -- calendar \
  2026-09-29T00:00:00+02:00 2026-09-30T00:00:00+02:00
```

No se incluye un flujo para obtener el token OAuth. Un piloto real debe
obtenerlo mediante autorización de la cuenta correspondiente y ejecutar este
comando en un entorno de servidor protegido.
