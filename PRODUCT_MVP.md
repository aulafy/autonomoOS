# PYMES/OS — contrato de producto vendible

Este documento fija qué significa convertir la demo actual en un producto que
una agencia de seguros pueda comprar y utilizar. La interfaz actual demuestra
el flujo, pero no debe venderse todavía como software operativo.

## Cliente inicial

Agencias y corredores pequeños de España con uno a diez agentes que reciben
mensajes por varios canales, preparan propuestas de coche, vida, hogar y
responsabilidad civil para autónomos, y necesitan mantener al día CRM, agenda,
llamadas e incidencias.

## Promesa del producto

Cada mañana el agente ve qué requiere atención, por qué, qué información falta,
qué llamada debe preparar y qué propuestas tienen una fuente verificable. El
sistema reduce trabajo administrativo y conserva al agente como responsable de
las decisiones y comunicaciones.

## Lo que debe existir antes de venderlo

### Cuenta y aislamiento

- organización/agencia como tenant;
- usuarios con roles `owner`, `agent` y `reviewer`;
- invitaciones y recuperación de acceso;
- aislamiento de mensajes, contactos, ofertas y documentos por tenant;
- auditoría de inicios de sesión, cambios, aprobaciones y exportaciones.

### Datos persistentes

- base de datos de servidor, migraciones y copias de seguridad;
- mensajes con `source`, `externalId`, `receivedAt`, consentimiento y estado;
- contactos y vínculos externos verificados;
- tareas, citas, llamadas y revisiones;
- ofertas con proveedor, referencia, documento, vigencia y estado;
- documentos almacenados con acceso restringido y retención configurable.

### Flujo operativo

1. Importar mensajes autorizados.
2. Deduplicar y clasificar como propuesta, incidencia, renovación, cita o gestión.
3. Verificar identidad contra el CRM.
4. Preparar borrador y preguntas pendientes.
5. Completar la ficha del ramo.
6. Obtener o transcribir una oferta con fuente.
7. Revisar y aprobar por una persona.
8. Ejecutar una escritura externa idempotente.
9. Observar el resultado y reconciliar estados inciertos.

### Integraciones del primer plan comercial

- Google Calendar: lectura y creación de citas mediante OAuth.
- Holded: lectura de contactos y actividades; escritura gobernada después.
- Correo empresarial: cuenta de prueba y permisos limitados.
- WhatsApp Business Platform o Telegram Bot: solo cuentas empresariales
  autorizadas.
- Messages for Business si el proveedor y el caso de uso lo permiten. Nunca
  prometer acceso a iMessage personal.

## Estados que el producto debe distinguir

```text
recibido
→ pendiente_de_identidad
→ clasificado
→ preparando_datos
→ oferta_recibida
→ pendiente_de_revision
→ aprobado
→ ejecutando
→ confirmado | incierto | rechazado
```

Una oferta `aprobada` no significa que la póliza esté contratada. La UI debe
mostrar siempre el proveedor, la referencia, la fecha y la fuente del dato.

## Arquitectura objetivo

```text
Web app
  ↓ sesión y API autenticada
API PYMES/OS
  ├─ tenant/auth/RBAC
  ├─ inbox y normalización
  ├─ CRM/calendar connectors
  ├─ quote catalog/adapters
  ├─ approval + effect executor
  └─ audit/event log
  ↓
PostgreSQL + object storage privado + cola de trabajos
```

La demo Vite actual debe convertirse en un cliente de esta API. Los fixtures
seguirán existiendo para tests y una cuenta de demostración, pero no serán la
fuente de datos del producto contratado.

## Plan de construcción

### Fase 1 — Base de producto

- API de servidor con tenant de demo aislado.
- PostgreSQL, migraciones y repositorios tipados.
- Sesión, roles y auditoría.
- Sustituir `makeDemoData()` en runtime por un `DataProvider`.
- Persistir mensajes, contactos, tareas, citas y ofertas.

### Fase 2 — Primer piloto controlado

- OAuth de Google Calendar.
- Lectura exacta de contactos de Holded.
- Importación de una cuenta de correo de prueba.
- Bandeja matinal persistente y revisión multiusuario.
- Documentos de oferta privados y expiración.

### Fase 3 — Escrituras gobernadas

- Crear actividad o tarea en Holded con clave de idempotencia.
- Crear o actualizar cita en Google Calendar.
- Estado `incierto` y reconciliación antes de reintentar.
- Aprobación con usuario, hora, motivo y versión del borrador.

### Fase 4 — Comercialización

- Onboarding de agencia en menos de 15 minutos.
- Página de configuración de conectores y permisos.
- Planes, límites y facturación.
- Exportación y borrado por tenant.
- Registro de tratamiento, retención y soporte.
- Pruebas de seguridad, backups y monitorización.

## Criterio de “vendible”

No marcar el producto como listo hasta que una agencia de prueba pueda:

1. crear una organización e invitar a dos usuarios;
2. conectar una cuenta de calendario y un CRM de prueba;
3. recibir mensajes de prueba persistentes;
4. verificar un contacto y preparar una propuesta;
5. adjuntar una oferta y conservar su procedencia;
6. pedir una aprobación a otro usuario;
7. ejecutar una escritura de prueba y ver su confirmación;
8. consultar el historial completo de cambios;
9. revocar un conector y exportar o eliminar sus datos.

Hasta superar estos puntos, hablar de “prototipo”, “piloto” o “demo”, no de
producto de producción.
