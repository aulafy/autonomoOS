# Crear una cápsula con Claude / Codex

El ejemplo `prospect-summary.ts` utiliza el SDK declarativo v1. Reutiliza la
lectura del CRM, el renderer y la configuración persistente del host.
No hay que copiar el CRM ni construir otro runtime.

## Probar y registrar

El test de cápsulas importa y registra este ejemplo en un workspace sintético.
Para incluirlo en el producto, tras revisar su código:

1. Importa `prospectSummary` desde `../examples/capsules/prospect-summary.js`
   en `pymes/src/capsule-registry.ts`.
2. Añádelo al array predeterminado del constructor de `CapsuleRegistry`:
   `[clientSummaryCapsule, prospectSummary]`.
3. Ejecuta los gates de la raíz:

```bash
npm test
npm run typecheck --workspaces --if-present
npm run build
git diff --check
```

4. Reinicia el servicio y activa la nueva cápsula desde **Mi Autónomo OS**.
   Su configuración pertenece al propietario autenticado y tiene historial
   independiente. El ejemplo no viene activado ni registrado en producción.

La pantalla permite descargar `KIT_CAPSULA_AUTONOMO_OS.md`, con los contratos
reales completos para el programador. El navegador no instala ni evalúa código.

## Límites de esta versión

Puedes cambiar identidad, título, límite y filtro de relación. El SDK solo
admite `crm.contact-summary`, `database.query` y `crm.local.contacts`.
El host interpreta ese permiso como una proyección acotada de lectura del CRM;
no autoriza SQL libre ni acceso a otras cuentas.

Otro renderer, recurso, conector o escritura necesita una ampliación revisada
del SDK y del host con sus tests. Las escrituras externas deben usar las rutas
existentes de aprobación exacta, Governed Runner y reconciliación.

Cambiar la versión disponible no actualiza una instalación silenciosamente:
el propietario debe confirmar la configuración de la versión nueva.
