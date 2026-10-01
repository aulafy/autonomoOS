# Conexiones reales: guía de puesta en marcha

Esta guía convierte el prototipo PYMES en una instalación conectable. Las credenciales se leen únicamente en el servidor o el worker; nunca se incluyen en la interfaz.

## 1. Variables base

Configura primero `PYMES_API_BOOTSTRAP_TOKEN`, `PYMES_API_BOOTSTRAP_TENANT`, `PYMES_API_BOOTSTRAP_USER`, `PYMES_API_WORKER_TOKEN` y `PYMES_API_DB_PATH`. En producción usa HTTPS delante del servidor y limita `PYMES_API_CORS_ORIGINS` a los dominios de la aplicación.

## 2. WhatsApp Cloud API

1. Crear una aplicación Meta Business y añadir WhatsApp.
2. Configurar el número y guardar el `phone_number_id`.
3. Generar un token permanente o de sistema con permisos de mensajería.
4. Publicar `/webhooks/whatsapp` en una URL HTTPS.
5. En Meta, usar `PYMES_WHATSAPP_WEBHOOK_VERIFY_TOKEN` como token de verificación.
6. Guardar el App Secret en `PYMES_WHATSAPP_APP_SECRET`.
7. Suscribirse al campo `messages`.
8. Añadir remitentes a `PYMES_OPENCLAW_PAIRED_SENDERS` y conversaciones consentidas a `PYMES_OPENCLAW_CONSENTED_CONVERSATIONS`.

El servidor rechaza firmas inválidas, mensajes sin consentimiento y duplicados. Las respuestas salen solo después de aprobación de un efecto.

## 3. LLM local

Instala Ollama en una máquina privada y descarga el modelo elegido:

```bash
ollama pull llama3.2:3b
```

Configura `PYMES_LOCAL_MODEL` y mantén el endpoint en una red privada. El modelo produce propuestas estructuradas de clasificación; no tiene acceso a tokens ni permisos para enviar mensajes o modificar el CRM.

## 4. Holded y Google Calendar

Configura `PYMES_HOLDED_API_KEY`, `PYMES_GOOGLE_ACCESS_TOKEN` y `PYMES_GOOGLE_CALENDAR_ID` únicamente en el proceso de lectura/worker. Empieza con lectura y scopes mínimos. Las escrituras de Calendar y CRM pasan por efectos confirmados e idempotentes.

## 5. Gateway alternativo

Si un canal no usa Meta, configura `PYMES_MESSAGE_GATEWAY_URL` y `PYMES_MESSAGE_GATEWAY_TOKEN`. El gateway debe aceptar `POST` autenticado y devolver `{ "externalId": "..." }`.

## 6. Orden recomendado de activación

1. Arrancar con datos ficticios y ejecutar `npm run check`.
2. Activar Ollama y validar clasificación sin efectos.
3. Activar Holded y Calendar en lectura.
4. Configurar Meta en modo prueba y verificar challenge/firma.
5. Añadir un único remitente emparejado y una conversación consentida.
6. Ejecutar un mensaje entrante y comprobar su auditoría en SQLite.
7. Activar un solo tipo de efecto aprobado y revisar sus métricas.

## Comprobaciones antes de producción

- `npm run check --workspace=@agent-world/pymes`
- `npm run check:operations --workspace=@agent-world/pymes`
- Backup verificable de `PYMES_API_DB_PATH`.
- Rotación de tokens documentada.
- Logs sin cuerpos de mensajes ni credenciales.
