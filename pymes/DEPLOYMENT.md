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
persistente, define `PYMES_API_DB_PATH` en un volumen estable.

## Interfaz

```bash
npm run demo:pymes
```

La interfaz local se sirve en `http://127.0.0.1:5174/`. Para conectarla a un
workspace, usa `?workspaceApi=http://127.0.0.1:8790&tenant=demo-agency` y guarda
el token en `sessionStorage` como `pymes.workspace.token`.

## OpenClaw Enterprise

El ingress se activa con `PYMES_OPENCLAW_INGRESS_TOKEN` y las listas de control:

```bash
PYMES_OPENCLAW_AGENT_IDS='agent-1' \
PYMES_OPENCLAW_RESOURCE_IDS='resource-1' \
PYMES_OPENCLAW_CHANNELS='whatsapp,telegram,email' \
PYMES_OPENCLAW_PAIRED_SENDERS='sender-1' \
PYMES_OPENCLAW_CONSENTED_CONVERSATIONS='conversation-1'
```

El endpoint `/healthz` no requiere autenticación. Todas las rutas de datos
requieren Bearer token y comprueban el tenant antes de leer o escribir.

## Operación

- Respaldar el fichero SQLite y su WAL como una unidad.
- Mantener el token bootstrap fuera del repositorio.
- Configurar un supervisor que envíe `SIGTERM` para el apagado ordenado.
- Monitorizar `/healthz` y revisar los efectos `failed` antes de reintentar.
- El volumen Docker usa `/data/pymes-workspace.db`; conservarlo junto con sus
  ficheros WAL durante los respaldos.
- Las listas `PYMES_OPENCLAW_*` deben configurarse con valores explícitos en
  producción; dejar una lista vacía bloquea el ingress correspondiente.
