# Traspaso para Claude Cowork — PYMES / agente de seguros

## Objetivo

Continuar construyendo un espacio de trabajo para una agencia o agente de seguros en España. El agente recibe mensajes de clientes y prospectos, prepara la jornada, organiza incidencias, propuestas, renovaciones, citas y llamadas, y mantiene el contexto del CRM y del calendario.

El producto debe ahorrar la primera hora de cada mañana sin tomar decisiones contractuales ni enviar mensajes por su cuenta. Toda acción externa debe quedar preparada, trazable y pendiente de aprobación humana.

## Repositorio y ejecución

Repositorio real:

```text
/Users/mac/Downloads/agent-world-os
```

Rama actual: `codex/h4-http-api`.

La demo está en `/Users/mac/Downloads/agent-world-os/pymes`.

```bash
cd /Users/mac/Downloads/agent-world-os
npm install
npm run demo:pymes
```

Abrir `http://127.0.0.1:5174/`.

Comprobaciones:

```bash
npm run typecheck --workspace=@agent-world/pymes
npm test --workspace=@agent-world/pymes
npm run build --workspace=@agent-world/pymes
```

## Estado actual

El repositorio real es la fuente de verdad. No reconstruirlo a partir del PDF mientras sea accesible.

La demo contiene:

- Bandeja ficticia de WhatsApp, Telegram, iMessage y correo.
- Priorización de incidencias, renovaciones y casos próximos.
- Duplicados por canal e identificador externo.
- Contactos cliente/prospecto y casos sin identidad.
- Preparación de llamadas y próxima cita relacionada.
- Cola de revisión humana en memoria.
- Corrección manual de intención y ramo con motivo obligatorio.
- Clasificador local opcional con Ollama, limitado a ocho mensajes ficticios.
- Lecturas de prueba de Holded y Google Calendar, sin OAuth ni escritura real.
- Ficha preliminar por ramo para coche, vida, hogar y responsabilidad civil de autónomos.
- Para vida, el cuestionario de la aseguradora es un paso externo; la demo no recoge datos de salud.
- Código nuevo sin commit: transcripción manual de ofertas recibidas de una aseguradora, con referencia, documento, prima, vigencia, coberturas y exclusiones. Debe validarse antes de confirmarlo.

Todos los datos de la interfaz son ficticios y se pierden al recargar. Las cuentas reales todavía no están conectadas.

## Archivos principales

```text
pymes/src/domain.ts              Resumen matinal, prioridades y borradores
pymes/src/main.ts                Interfaz y estado de sesión
pymes/src/fixtures.ts            Mensajes, contactos y citas ficticios
pymes/src/config.ts              España, Holded, Google Calendar y ramos
pymes/src/call-plan.ts           Preparación de llamadas
pymes/src/classification.ts      Validación y aceptación humana
pymes/src/local-classifier.ts    Cliente Ollama local
pymes/src/connectors.ts          Lecturas HTTP de Holded y Google Calendar
pymes/src/integration-view.ts    Vínculos explícitos entre datos externos y locales
pymes/src/quote-intake.ts        Requisitos y estados de ficha por ramo
pymes/src/quote-offers.ts        Validación de ofertas transcritas
pymes/vite.config.ts             Ruta de demo para clasificación local
pymes/tests/                     Tests de dominio, conectores y flujos
pymes/README.md                  Descripción funcional
pymes/ARCHITECTURE.md            Límites y reglas de integración
pymes/INTEGRATIONS.md            Canales y conectores previstos
```

## Decisiones de producto

País: España. Ramos iniciales: coche, vida, hogar y responsabilidad civil para autónomos.

CRM de referencia inicial: Holded. Tiene CRM, enfoque para autónomos y API documentada. No afirmar que sea estadísticamente el CRM más utilizado por autónomos españoles: no hay una clasificación independiente reciente que lo demuestre. Si la agencia usa ebroker u otro CRM, adaptar el conector en vez de crear una segunda ficha maestra.

Calendario previsto: Google Calendar, inicialmente solo lectura y con OAuth autorizado.

## Reglas obligatorias

1. El repositorio y sus tests tienen prioridad sobre el PDF.
2. No inventar primas, coberturas, exclusiones, condiciones ni disponibilidad.
3. Una propuesta del modelo es solo una propuesta; nunca cambia datos sin aceptación humana y motivo.
4. No vincular contactos por nombre o similitud. Solo por ID externo verificado por una persona.
5. Un caso sin identidad permanece visible, pero no recibe borrador personalizado ni puede avanzar a cotización.
6. Una oferta solo puede registrarse después de completar los datos preliminares y, en vida, confirmar el paso externo de la aseguradora.
7. Toda oferta debe conservar aseguradora, referencia, documento de origen, fecha de entrada y vigencia. Mostrarla como documento aportado, no como recomendación.
8. No introducir datos médicos en la demo. El cuestionario de vida se realiza por el canal autorizado de la aseguradora.
9. No conectar WhatsApp personal, iMessage personal ni cuentas privadas por suposiciones.
10. Toda escritura futura en CRM, calendario o mensajería necesita aprobación, idempotencia, resultado observable y reconciliación si la respuesta es incierta.

## Qué hacer al continuar

### 1. Diagnóstico

```bash
cd /Users/mac/Downloads/agent-world-os
git status --short
git log --oneline -8
npm run typecheck --workspace=@agent-world/pymes
npm test --workspace=@agent-world/pymes
npm run build --workspace=@agent-world/pymes
```

Hay cambios no confirmados en `pymes/src/quote-intake.ts`, `pymes/src/quote-offers.ts` y `pymes/src/main.ts`. Inspeccionarlos y conservarlos. No ejecutar `git reset --hard`.

### 2. Cerrar la funcionalidad de ofertas

En la interfaz:

1. Abrir una propuesta de hogar o coche.
2. Marcar todos los datos preliminares.
3. Registrar una oferta de prueba con referencia y documento ficticios.
4. Comprobar que aparecen procedencia, vigencia, prima, coberturas y exclusiones.
5. Comprobar que una identidad no vinculada no puede marcar la ficha.
6. Comprobar que vida exige el paso externo y no muestra campos de salud.
7. Comprobar que no se recomienda automáticamente una oferta ni se envía nada.

Revisar el parseo de importes europeos, las fechas de vigencia, los duplicados de referencia y la accesibilidad de la ficha. Ejecutar todos los tests y hacer un commit separado cuando esté verificado.

### 3. Siguiente hito: tarificador de prueba

Construir un catálogo/tarificador local con contratos explícitos. Debe aceptar solo datos verificados y devolver ofertas con `provider`, `productId`, `reference`, `retrievedAt`, `validUntil` y documento de condiciones. Debe fallar cerrado si faltan datos o el proveedor responde de forma ambigua. Usar fixtures o un servidor local; todavía no conectar una aseguradora real.

Flujo esperado:

```text
mensaje → identidad verificada → ficha completa → proveedor autorizado
→ oferta trazable → revisión humana → futura acción gobernada
```

La interfaz debe distinguir “oferta recibida”, “pendiente de revisión” y “aceptada por el agente”. No añadir contratar, pagar, modificar póliza ni enviar mensajes hasta tener controles de efecto y aprobación.

### 4. Orden de integraciones reales

1. Google Calendar de solo lectura con OAuth de prueba.
2. Holded de solo lectura para coincidencia exacta de teléfono y revisión humana.
3. Correo empresarial de prueba.
4. WhatsApp Business o Telegram Bot con cuenta autorizada.
5. Estudiar Messages for Business; no asumir acceso a iMessage personal.
6. Una única escritura gobernada en CRM o calendario, con idempotencia y reconciliación.
7. Mensajería saliente después de aprobación humana y pruebas de fallo.

## Commits relevantes

```text
9fdca7d Add per-line quote preparation checklist to PYMES demo
04c4927 Show local model proposals in insurance demo
8d6681f Add local demo insurance classifier and evaluation
d5ed64d Add human-reviewed insurance classification corrections
c1a331d Add review queue and call preparation to insurance demo
00b6cc0 Keep unidentified customer messages in morning inbox
4930536 Add bounded calendar reads and local integration probe
0c71e32 Require verified links for CRM and calendar context
```

## Resultado buscado

Una herramienta diaria que convierta mensajes dispersos en trabajo ordenado: qué atender primero, qué falta, qué llamada preparar, qué oferta está documentada y qué necesita aprobación. Debe ser útil sin fingir acceso a cuentas, tarifas o pólizas que todavía no estén conectadas.
