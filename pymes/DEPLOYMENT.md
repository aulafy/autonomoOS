# Despliegue de PYMES Workspace

## Desarrollo local

Desde la raíz del monorepo:

```bash
npm install
PYMES_API_BOOTSTRAP_TOKEN='token-local-de-16-caracteres' \
  npm run api --workspace=@agent-world/pymes
```

Comprobar:

```bash
curl http://127.0.0.1:8790/healthz
```

Usa `/readyz` para el readiness check del orquestador.

La base se crea en `./data/pymes-workspace.db` por defecto. Para un entorno
persistente, define `PYMES_API_DB_PATH` en un volumen estable. `PYMES_API_VERSION`
permite fijar la versión visible en `/healthz` y `/readyz` sin recompilar; por
defecto es `0.1.0`.
`PYMES_API_BOOTSTRAP_TOKEN` se recorta al arrancar y debe tener al menos 16
caracteres efectivos, con un máximo de 4.096.
`PYMES_API_HOST` se recorta, se limita a 255 caracteres y rechaza caracteres de
control antes de abrir el socket de escucha.
`PYMES_API_BOOTSTRAP_TENANT` y `PYMES_API_BOOTSTRAP_USER` también se recortan al
arrancar para evitar espacios accidentales en el namespace inicial.
Las sesiones persistidas guardan un hash SHA-256 del token; las bases creadas
con versiones anteriores migran el valor legado al primer uso válido.
La misma versión se guarda en el label OCI
`org.opencontainers.image.version`, para identificar el artefacto en un
registry o inventario de contenedores sin arrancarlo.
El build usa la raíz del repositorio como contexto; las exclusiones efectivas
de la imagen están en [`.dockerignore`](../.dockerignore).

Al construir la imagen directamente, pasa el mismo valor como argumento:

```bash
docker build --build-arg PYMES_API_VERSION=2026.09.30 \
  --file pymes/Dockerfile --tag pymes-workspace:2026.09.30 .
```

Para Kubernetes hay una plantilla base en [`k8s/deployment.yaml`](k8s/deployment.yaml).
Adapta el nombre de la imagen, el `StorageClass` y el gestor de secretos antes
de aplicarla. SQLite usa un volumen `ReadWriteOnce` y la plantilla mantiene una
sola réplica; el escalado horizontal requiere migrar primero a un almacenamiento
transaccional compartido. La plantilla tampoco monta el token de ServiceAccount
porque el workspace no necesita consultar la API de Kubernetes.
El `ConfigMap` incluido fija `PYMES_API_CORS_ORIGINS`; reemplaza
`https://app.example.com` por los orígenes exactos de tu interfaz y no uses `*`.
También contiene las listas no secretas de política OpenClaw (agentes, recursos,
canales, remitentes emparejados y conversaciones consentidas). Déjalas vacías
para mantener cada control cerrado hasta completar el emparejamiento. Las
ventanas de antigüedad y desfase futuro también se fijan en el ConfigMap y
conservan los valores seguros del despliegue Compose.
[`k8s/secret.example.yaml`](k8s/secret.example.yaml) solo contiene marcadores de
posición: genera el Secret real desde tu gestor de secretos y no lo versiones.
Sus claves `openclaw-ingress-token` y `openclaw-signing-secret` son opcionales;
si faltan, el ingress OpenClaw queda desactivado de forma segura.
La base se puede aplicar con `kubectl apply -k pymes/k8s`; crea el Secret real
antes de arrancar el Deployment.
Para clusters con NetworkPolicy, revisa
[`k8s/network-policy.example.yaml`](k8s/network-policy.example.yaml): exige
etiquetar el namespace cliente con `pymes-client=true`, permite DNS y HTTPS
saliente para Holded/Google Calendar y bloquea el resto del tráfico.

## Interfaz

```bash
npm run demo:pymes
```

La interfaz local se sirve en `http://127.0.0.1:5174/`. Para conectarla a un
workspace, usa `?workspaceApi=http://127.0.0.1:8790&tenant=demo-agency` y guarda
el token en `sessionStorage` como `pymes.workspace.token`.

En producción, define `PYMES_API_CORS_ORIGINS` con una lista separada por
comas de los dominios exactos de la interfaz (por ejemplo,
`https://app.agencia.example`). No uses `*`: el API utiliza credenciales Bearer
y debe mantener una allowlist explícita; el servidor rechaza `*` al arrancar.

Validación rápida desde el host de despliegue:

```bash
curl -i -X OPTIONS http://127.0.0.1:8790/healthz \
  -H 'Origin: https://app.agencia.example' \
  -H 'Access-Control-Request-Method: GET'
```

La respuesta debe incluir `Access-Control-Allow-Origin` con ese origen exacto.

## OpenClaw Enterprise

El ingress se activa con `PYMES_OPENCLAW_INGRESS_TOKEN`, que se recorta al
arrancar y debe tener entre 16 y 4.096 caracteres efectivos, además de las listas
de control. Cada lista admite hasta 100 identificadores y cada identificador
puede tener como máximo 200 caracteres; los duplicados se eliminan al arrancar:

```bash
PYMES_OPENCLAW_AGENT_IDS='agent-1' \
PYMES_OPENCLAW_RESOURCE_IDS='resource-1' \
PYMES_OPENCLAW_CHANNELS='whatsapp,telegram,email' \
PYMES_OPENCLAW_PAIRED_SENDERS='sender-1' \
PYMES_OPENCLAW_CONSENTED_CONVERSATIONS='conversation-1' \
PYMES_OPENCLAW_SIGNING_SECRET='cambia-este-secreto-largo' \
PYMES_OPENCLAW_MAX_EVENT_AGE_MS='604800000' \
PYMES_OPENCLAW_MAX_FUTURE_SKEW_MS='600000'
```

Las dos últimas variables controlan la ventana temporal de eventos. El servidor
rechaza valores negativos, no numéricos o superiores a los máximos permitidos.

El endpoint `/healthz` no requiere autenticación. Todas las rutas de datos
requieren Bearer token y comprueban el tenant antes de leer o escribir.
Cuando se configura `PYMES_OPENCLAW_SIGNING_SECRET`, debe tener entre 16 y
4.096 caracteres efectivos y cada petición debe incluir la firma HMAC descrita
en `API.md`; el token y la firma se validan de forma independiente.

## Operación

- Respaldar el fichero SQLite y su WAL como una unidad.
- Mantener el token bootstrap fuera del repositorio.
- El servicio Compose se ejecuta sin capacidades Linux y con
  `no-new-privileges`; conservar estas restricciones en cualquier manifiesto
  equivalente.
- La imagen ejecuta el proceso como usuario `node`, escucha en `0.0.0.0` dentro
  del contenedor y declara un healthcheck que consulta `/readyz`; al migrar a
  Kubernetes, Nomad u otro orquestador conserva esa separación entre liveness
  (`/healthz`) y readiness (`/readyz`).
- El root filesystem es de solo lectura; `/data` es el único almacenamiento
  persistente y `/tmp` se monta como temporal.
- Compose concede 30 segundos para el apagado ordenado y el cierre de SQLite.
- El contenedor usa `SIGTERM` para activar el apagado ordenado antes de ese
  periodo de gracia.
- El servicio está limitado a 512 MiB de memoria y 1 CPU; ajusta estos límites
  según el volumen real de mensajes y citas.
- Tiene una reserva mínima de 128 MiB para mantener capacidad básica bajo
  presión del host.
- El límite de swap coincide con el de memoria para evitar degradación
  silenciosa por swapping.
- El límite de procesos es 100 para contener fallos que creen procesos en
  cascada.
- Los descriptores de archivo están limitados a 4.096 blandos y 8.192 duros;
  ajústalos si el volumen de conexiones lo requiere.
- Compose usa un init ligero para recoger procesos hijos y evitar zombies.
- Los logs se rotan en tres archivos de 10 MiB para no llenar el disco del
  host; envía los registros a tu plataforma central si necesitas retención.

Backup consistente con el contenedor detenido:

```bash
docker compose stop pymes-workspace
docker run --rm -v pymes-data:/data -v "$PWD/backups:/backup" \
  alpine sh -c 'tar czf /backup/pymes-$(date +%Y%m%d-%H%M%S).tgz -C /data .'
docker compose start pymes-workspace
```

También puedes usar el script versionado:

```bash
docker compose stop pymes-workspace
bash pymes/scripts/backup-volume.sh ./backups
docker compose start pymes-workspace
```

Para verificar un backup sin tocar producción:

```bash
bash pymes/scripts/verify-backup.sh ./backups/pymes-YYYYMMDD-HHMMSS.tgz
```

Conserva el archivo generado y su checksum fuera del host de ejecución y prueba una
restauración periódicamente.

Restauración de un backup:

```bash
sha256sum --check backups/pymes-YYYYMMDD-HHMMSS.tgz.sha256
docker compose stop pymes-workspace
docker run --rm -v pymes-data:/data -v "$PWD/backups:/backup" \
  alpine sh -c 'rm -rf /data/* && tar xzf /backup/pymes-YYYYMMDD-HHMMSS.tgz -C /data'
docker compose start pymes-workspace
curl --fail http://127.0.0.1:8790/readyz
```

Realiza la restauración primero en un entorno de staging y conserva el
backup anterior hasta validar la recuperación.
- Configurar un supervisor que envíe `SIGTERM` para el apagado ordenado.
- Monitorizar `/healthz` y revisar los efectos `failed` antes de reintentar.
- Para una alarma operativa autenticada, consultar las métricas del tenant (la
  respuesta no contiene contenido de mensajes):

  ```bash
  curl --fail --silent \
    -H "Authorization: Bearer $PYMES_API_BOOTSTRAP_TOKEN" \
    "http://127.0.0.1:8790/v1/workspaces/$PYMES_API_BOOTSTRAP_TENANT/metrics"
  ```

  Para un panel operativo, la cola accionable está disponible en
  `/v1/workspaces/$PYMES_API_BOOTSTRAP_TENANT/attention`; debe conservar la
  misma autenticación y tratar `401` o `403` como error de configuración.

  La monitorización debe alertar cuando `effects.byStatus.failed` sea mayor que
  cero, cuando `inbox.byState.pending_review` supere el umbral acordado con la
  agencia, cuando la respuesta incluya `STALE_CASES` (casos pendientes con más
  de 24 horas) o `UNCERTAIN_CASES` (resultados que requieren revisión manual).
  Las respuestas `401` y `403` deben tratarse como fallo de la
  configuración de monitorización, no como ausencia de actividad.
- El volumen Docker usa `/data/pymes-workspace.db`; conservarlo junto con sus
  ficheros WAL durante los respaldos.
- Las listas `PYMES_OPENCLAW_*` deben configurarse con valores explícitos en
  producción; dejar una lista vacía bloquea el ingress correspondiente.

También se incluye `pymes/scripts/check-operations.sh` para supervisores que
necesiten un código de salida: devuelve `0` si no hay fallos y la cola está bajo
el límite, y `2` si hay operaciones fallidas, demasiados pendientes, casos
inciertos o una respuesta inválida. Requiere `curl` y `jq` para interpretar las métricas; si
`jq` falta, el script falla cerrado con código `2`. El script nunca muestra el
token.

Configuración mínima del script:

```bash
export PYMES_API_BASE_URL=https://workspace.example.com
export PYMES_API_TOKEN='token-de-monitorizacion'
export PYMES_API_TENANT=agency-1
export PYMES_PENDING_REVIEW_LIMIT=20
npm run check:operations
```

El token de monitorización debe ser independiente del token de una persona y
rotarse según la política de la empresa.

Los workers pueden recibir `PYMES_MESSAGE_GATEWAY_URL`/`TOKEN`,
`PYMES_CRM_GATEWAY_URL`/`TOKEN` y `PYMES_CALL_GATEWAY_URL`/`TOKEN` para sus
salidas. Son variables opcionales y deben inyectarse como secretos del
despliegue; nunca se deben incluir en la interfaz ni en el repositorio. Si un
gateway no está configurado, el efecto permanece confirmado hasta que un
worker autorizado pueda procesarlo.
Configura además `PYMES_API_WORKER_TOKEN` y `PYMES_API_WORKER_ID` para
provisionar una sesión dedicada con rol `worker`; no reutilices el token
bootstrap del propietario.
El servidor valida estas parejas durante el arranque y termina antes de
escuchar si falta un token, la URL no usa HTTPS o contiene credenciales.

### Worker residente

El módulo `runEffectWorker` proporciona el ciclo residente: hace un polling,
espera el intervalo configurado y vuelve a consultar sin ejecutar dos ciclos a la
vez. El proceso debe recibir un `AbortSignal` desde su supervisor para responder a
`SIGTERM`; así termina el ciclo actual antes de salir. Mantén el worker separado
del proceso HTTP y usa una sesión dedicada con rol `worker`.

El intervalo aceptado está entre 250 ms y 300.000 ms; para producción se
recomienda empezar en 5.000 ms. Un error de polling debe producir una salida no
cero para que Kubernetes, systemd o el supervisor elegido pueda reiniciar el
worker. Los logs solo deben contener identificador de efecto, estado, duración y
`requestId`, nunca el texto del mensaje ni tokens.
Para métricas agregadas, conecta `onSummary` del worker: entrega únicamente
`total`, `succeeded`, `failed` y `skipped`. El callback detallado queda reservado
para diagnóstico controlado y no debe publicarse en paneles multiusuario.

Para un `CronJob`, configura `maxCycles` en el código de arranque para que el
proceso termine después de la ventana prevista. El valor debe estar entre 1 y
10.000; omitirlo activa el modo residente. El `CronJob` debe conservar el mismo
token dedicado y no ejecutar dos instancias simultáneas sobre el mismo tenant.
Hasta que se incorpore leasing atómico en el contrato de efectos, mantén una sola
instancia de worker por tenant; el API no asigna reservas entre workers.
El `leaseStore` actual es una protección local del proceso y no sustituye esa
restricción de despliegue.
`SqliteEffectLeaseStore` ya permite persistir la reserva en la misma base SQLite;
la activación multiworker queda condicionada a exponer esa operación mediante el
API con aislamiento explícito por tenant y auditoría de adquisición/liberación.
El namespace del store debe ser exactamente el tenant autenticado del worker para
impedir que dos agencias con el mismo `effectId` compartan una reserva.
