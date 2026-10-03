# M3 — Gmail local con ejecución gobernada

Fecha: 2026-10-04
Repositorio: `/Users/mac/Downloads/agent-world-os`
Base aceptada M2: `3c60937`

## Estado

Implementado el conector Gmail y su integración con el producto. Verificado con transporte HTTP sintético y llavero nativo real con datos sintéticos. **M3 no está cerrado: falta OAuth con una cuenta real y comprobar la llegada de un correo a un destinatario de prueba.** Las pruebas sintéticas no demuestran entrega real.

## Recorrido

Plan → C8/C9 → aprobación durable del payload y versión exactos → Governed Runner C11 → Effect → EmailProvider → Gmail API → observación/reconciliación.

La UI guarda un borrador y solicita revisión, aprobación y ejecución. No contiene tokens de Google ni llama directamente a Gmail. Se conserva FakeEmailProvider para M2/tests. No se modifica la máquina de estados del core. La clasificación de rechazo certificado previo al dispatch se amplía mediante EmailDispatchError.

La aprobación Gmail incorpora el contexto de cuenta y generación de conexión. Cambiar la cuenta o reconectar invalida la aprobación anterior. El contenido se bloquea después de crear su revisión.

## Credenciales y OAuth

- Aplicación Google OAuth de tipo Desktop, navegador del sistema, PKCE S256, state aleatorio y callback en `127.0.0.1` con puerto efímero.
- Callback de un solo uso, validación de estado/host, caducidad de cinco minutos, comprobación de la sesión local al completar.
- Identidad comprobada con userinfo y email_verified. No se usa getProfile bajo gmail.send.
- Tokens, refresh token y client secret en macOS Keychain mediante `pymes/native/keychain.swift`. El helper recibe secretos por stdin y devuelve datos por pipe; nunca usa argumentos con secretos ni plaintext fallback.
- Configuración y credencial usan referencias opacas por tenant/owner. SQLite guarda el contenido aprobado, intentos y evidencia, nunca credenciales Google.
- Refresh sin reintentos automáticos, compartido por llamadas simultáneas. Desconectar invalida respuestas tardías y elimina las credenciales locales. Mantiene configuración del cliente OAuth en Keychain, jobs e historial.
- Desconectar no revoca el permiso remoto en la cuenta Google ni puede retirar un correo ya aceptado. La revocación remota puede hacerse desde la cuenta Google.
- Piloto: un propietario y una cuenta Gmail por proceso/tenant. API Gmail solo en loopback; no combinar Fake y Gmail en el mismo proceso.

## Permisos exactos

| Scope | Motivo |
| --- | --- |
| `https://www.googleapis.com/auth/gmail.send` | Enviar el MIME aprobado. |
| `openid` | Identidad de la cuenta de Google. |
| `email` | Dirección verificada que se muestra y se impone como From. Google puede devolver su alias userinfo.email. |
| `https://www.googleapis.com/auth/gmail.readonly` | Opcional, desmarcado por defecto: consultar raw en Enviados y buscar Message-ID para reconciliar. |

**gmail.readonly permite leer toda la cuenta**, aunque este adaptador solo consulta Enviados. Su consentimiento debe ser explícito. No se pide `https://mail.google.com/`. gmail.metadata no permite buscar con q ni verificar el cuerpo; no satisface esta prueba de contenido exacto.

Sin gmail.readonly no hay consulta independiente: una respuesta 200 del envío aporta un recibo, pero el efecto sigue UNKNOWN sin observación comprobada. No equivale a un envío fallido y no se debe repetir.

Referencias oficiales: [OAuth desktop](https://developers.google.com/identity/protocols/oauth2/native-app), [scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [búsqueda messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

## MIME y evidencia

Inicialmente: un To, From de la cuenta conectada, Subject UTF-8 y cuerpo text/plain UTF-8. CC/BCC siguen en el contrato pero M3 los rechaza. Sin HTML ni adjuntos. La codificación base64 preserva los bytes del cuerpo aprobado y sus saltos de línea.

- Message-ID determinista: `<awos.<effect-key>@autonomo-os.invalid>`.
- Cabecera `X-AWOS-Payload-SHA256` del payload aprobado.
- Antes del POST se registra un claim SQLite durable WAL/FULL con clave única.
- Un claim existente prohíbe otro POST con esa clave, incluso tras reinicio.
- El claim no acredita envío. Un crash en el hueco claim→HTTP queda incierto aunque todavía no hubiera llamada.
- Consulta primero el Gmail id conocido; si no hay prueba, busca `in:sent rfc822msgid:<marker>`.
- Exige label SENT y coincidencia de Message-ID, hash, From, To, Subject, tipo MIME y cuerpo exacto. Sin coincidencia o con búsqueda ambigua queda UNKNOWN.
- Reconciliación hace GET solamente. No reenvía ni convierte una ausencia de resultados en prueba de no envío.
- Gmail no proporciona aquí una garantía de idempotencia nativa. La marca es correlación propia; si Gmail transforma el MIME o sustituye cabeceras relevantes, la verificación conservadora puede quedarse UNKNOWN.
- Ver Enviados prueba aceptación registrada por Gmail, **no recepción en el buzón del destinatario**, ausencia de rebote o lectura. La entrega real de la prueba requiere comprobarla aparte.
- Desconectar impide nuevos dispatch. Una petición ya en curso puede ser aceptada antes de la desconexión; conserva su incertidumbre y su evidencia.

## Instalación para prueba real

1. En Google Cloud, habilitar Gmail API, configurar consentimiento y usuario de prueba cuando corresponda, crear un cliente OAuth **Desktop**. Descargar su JSON a una ruta local protegida. No pegar secretos en chat ni añadir el JSON al repositorio.
2. Desde la raíz:

```sh
npm run gmail:build-keychain --workspace=@agent-world/pymes
```

3. Configurar el servicio local con rutas (sin secretos en argumentos/env):

```text
PYMES_GMAIL_ENABLED=1
PYMES_API_HOST=127.0.0.1
PYMES_GMAIL_KEYCHAIN_HELPER=/Users/mac/Downloads/agent-world-os/pymes/data/bin/gmail-keychain
PYMES_GMAIL_DESKTOP_CLIENT_PATH=<ruta local al JSON Desktop>
PYMES_FAKE_EMAIL_ENABLED=0
```

Las variables de sesión, tenant, DB y modelo siguen las instrucciones M1/M2. Usar un tenant de piloto y una base de datos nueva evita mezclar trabajos de simulación con nuevos Gmail. El backend importa el cliente al llavero; no copia el JSON. El original descargado contiene secretos: debe gestionarlo el propietario/instalador de forma segura. Tras importar, puede quitarse la variable de ruta; la configuración permanece en Keychain.

4. Abrir Configuración y conectar el workspace. Conectar Gmail abre el navegador del sistema. El propietario completa el consentimiento. Para cierre verificado de M3, autorizar lectura opcional en la cuenta de prueba.
5. Crear y planificar un trabajo. Guardar destinatario/asunto/texto de prueba, evaluar, revisar exactamente el contenido, aprobar y ejecutar.
6. Comprobar evidencia en el runtime y llegada real en el destinatario. No repetir un efecto UNKNOWN. Consultar/reconciliar si hay permiso de lectura.
7. Reiniciar la API, comprobar persistencia; desconectar, comprobar que no hay nuevas ejecuciones y se conserva la historia.

El ejecutable del llavero debe mantenerse estable durante la instalación. Su compilación requiere las herramientas de desarrollo de Apple. La firma, distribución y actualización del appliance comercial quedan fuera de esta prueba M3.

## Interfaz

Configuración: desconectado/conectando/conectado/error, cuenta, permisos, última comprobación, comprobar y desconectar. Sin tokens. Centro de agentes: borrador editable antes de revisar, payload exacto, aprobación, runner, efectos y evidencia.

La preparación del lead y las operaciones CRM siguen siendo fixtures locales; no se acredita un CRM real ni lectura del inbox. Los registros históricos M2 conservan su identificación de simulación. La prueba visual usa un transporte sintético indicado en el nombre del trabajo, no una cuenta de Gmail real.

## Inbox posterior

Servicio separado de sincronización, sin autoridad de envío: full sync inicial → guardar cursor historyId por cuenta/tenant → history.list incremental → si 404 por cursor obsoleto, full sync de nuevo. Persistir cursor solo después de ingestión durable/deduplicada; páginas intermedias no adelantan el checkpoint. Cambiar cuenta invalida el cursor. El GmailEmailProvider de M3 se mantiene como adaptador de effects; no se ha implementado este servicio de inbox.

Referencia: [guía oficial de sincronización](https://developers.google.com/workspace/gmail/api/guides/sync).

## Verificación y pendiente

Resultado: 715 tests totales, 714 pasan, 0 fallan, 1 test opcional Orca omitido. Los 19 nuevos tests Gmail pasan. Typecheck y build de todos los workspaces correctos. Llavero nativo: escritura, lectura y borrado de un registro sintético verificados. QA en navegador: borrador, revisión, aprobación, runner, evidencia y controles de cuenta/permisos.

Tests cubren MIME UTF-8/saltos de línea/tampering, OAuth cancelado/éxito/estado incorrecto/caducidad, refresh/credencial revocada, respuestas tardías tras desconectar, 401/403/429/5xx, timeout, respuesta perdida, ausencia/ambigüedad, scope solo envío, reinicio y SIGKILL real de un proceso contra un servidor Gmail sintético independiente.

SIGKILL: el servidor de prueba acepta MIME, retiene la respuesta; se mata el proceso; C12 restaura UNKNOWN; GET verifica el MIME; C7 proyecta committed sin reescribir el UNKNOWN histórico ni hacer otro POST.

Pendiente para cerrar M3: ruta al JSON Desktop, cuenta de prueba, consentimiento para gmail.readonly si se quiere reconciliación automática comprobable, destinatario y entrega real. No se ha lanzado consentimiento real ni enviado correo real.


## Protocolo de cierre A/B/C acordado

No crear tag de cierre ni iniciar M4 hasta completar las validaciones reales pendientes.

### Preparación de Google

Usar proyecto con Gmail API habilitada y OAuth Desktop. Para una cuenta Gmail personal, configurar audiencia External/Testing y añadir explícitamente el remitente como usuario de prueba. Registrar en Data Access gmail.send y los permisos de identidad; si se autoriza la comprobación independiente implementada, añadir también gmail.readonly. El permiso solo envío no habilita messages.list/get ni permite cerrar la prueba C con este verificador.

En External/Testing, los refresh tokens de una autorización que incluye Gmail caducan a los siete días. Una prueba B próxima demuestra persistencia entre reinicios, no autorización indefinida. La preparación para producción/verificación OAuth es trabajo posterior de distribución del producto.

Fuentes oficiales: [estado OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [caducidad en Testing](https://developers.google.com/identity/protocols/oauth2), [permisos de messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

### A — Envío normal real

1. Conectar desde Configuración usando el cliente importado al Keychain y completar el consentimiento con la cuenta remitente de prueba.
2. Comprobar cuenta/scopes en UI. No imprimir ni exportar el contenido de los registros de Keychain para demostrar almacenamiento.
3. Crear un trabajo con asunto único `M3-A-<fecha-hora>` y contenido inocuo dirigido a una segunda cuenta confirmada por el propietario.
4. Guardar, evaluar, revisar el destinatario y el texto exactos, aprobar y ejecutar mediante Governed Runner.
5. Registrar taskId, reviewId/bindingHash, effectId, observationIds, Gmail id si está disponible, Message-ID y hora. No incluir Authorization ni tokens en la evidencia.
6. Comprobar en la segunda cuenta que ha llegado exactamente un mensaje con asunto/cuerpo esperados. Verificar separadamente efecto committed y progreso en la UI.

### B — Reinicio real

1. Cerrar de forma normal el proceso API del piloto y volver a arrancar con las mismas rutas DB, tenant y propietario. No borrar datos ni desconectar Gmail.
2. Comprobar que la cuenta reaparece desde Keychain y que se conserva el historial A.
3. Crear un trabajo nuevo con asunto único `M3-B-<fecha-hora>`, obtener una nueva aprobación y efectuar otro envío por el runner.
4. Comprobar recepción única y evidencia independiente. El refresh se comprueba además por tests de expiración; no debe forzarse mostrando/editando tokens reales.

### C — Respuesta perdida, SIGKILL y reconciliación

La prueba equivalente automatizada ya existe en `pymes/tests/gmail-runtime.test.ts`: un servidor HTTP independiente acepta MIME, retiene la respuesta; se mata el proceso del runner con SIGKILL; se restaura el journal y la ledger; se observa UNKNOWN y se reconcilia mediante GET, con un único POST en todo el recorrido.

Para una variante contra Google se debe usar exclusivamente un transporte de fault-injection del piloto, conectado al fetcher inyectable existente: consumir y descartar una respuesta exitosa de messages.send antes de entregarla al adaptador, sin volver a ejecutar el POST. No activar fallos globales en el servicio utilizado para A/B y no cambiar la semántica del core. Todavía no se ha ejecutado esta variante contra Google.

Criterios: conservar aprobación exacta, comprobar UNKNOWN histórico después del fallo/reinicio, consultar el Message-ID ya implementado, verificar MIME exacto y SENT, conservar la decisión de reconciliación y confirmar un único mensaje en el destinatario. C7 puede proyectar resultado efectivo committed mientras C6 conserva UNKNOWN histórico. No es necesario reescribir el efecto original a committed para acreditar reconciliación.

### Registro de aceptación

| Comprobación | Estado actual | Evidencia pendiente |
| --- | --- | --- |
| OAuth Desktop con Google real desde UI | Pendiente | Cuenta/cliente de prueba y consentimiento |
| Keychain nativo | Verificado con datos sintéticos | Credencial real guardada por OAuth, sin exponerla |
| A: entrega real + efecto comprobado | Pendiente | Mensaje recibido y referencias del efecto |
| B: conexión tras reinicio + segundo envío | Pendiente | Capturas/refs del segundo trabajo |
| C: SIGKILL, UNKNOWN, reconciliación sin duplicado | Equivalente sintético verificado | Variante Google si se exige para la aceptación final |
| Ausencia de secretos en auditoría/SQLite/logs reales | Pendiente de sesión real | Inspección que informe solo coincidencias, sin imprimir secretos |
| Suite, tipos y build | Verificados en M3 | Repetir si cambia código durante el piloto |
| Tag de cierre M3 | No creado | Aceptación de las evidencias reales |

La aceptación sintética de C no sustituye OAuth real, llegada del correo real ni persistencia real de B. M4 sigue pendiente del cierre M3.
