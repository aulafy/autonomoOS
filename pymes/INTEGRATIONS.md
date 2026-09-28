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
| Correo y calendario | Dependen del proveedor concreto de la agencia. | Primer candidato para una integración de prueba y solo lectura tras elegir proveedor y cuenta. |
| CRM | Depende del producto usado por la agencia. | Definir campos, identidad, permisos y API antes de actualizar expedientes. |

El orden de integración se decidirá con la agencia. Para el primer piloto,
conviene empezar por una fuente que permita acceso de prueba autorizado y una
salida cuyo resultado pueda observarse. La propuesta, la respuesta al cliente
y cualquier cambio en CRM o calendario quedan sujetos a aprobación humana y a
los controles de Agent World OS.
