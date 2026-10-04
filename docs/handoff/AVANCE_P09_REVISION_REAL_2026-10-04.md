# P09 · Revisión real de respuestas

Fecha: 4 de octubre de 2026. Repositorio: `/Users/mac/Downloads/agent-world-os`.
Rama: `codex/h4-http-api`. Base: `0f27d1b` (P08). Este informe acompaña al commit P09.

## Implementado

- Pantalla **Revisión** conectada al runtime durable y al CRM local. Una fila por
  última versión; los predecesores cancelados conservan su historial y quedan
  accesibles desde la revisión de la versión nueva.
- Contadores, búsqueda de trabajo/cliente con normalización de tildes, filtros
  y paginación. UNKNOWN se ordena primero. Los contadores corresponden a todos
  los trabajos actuales del propietario; la búsqueda filtra la lista, no esos
  contadores. Los trabajos todavía sin borrador revisado se indican por preparar.
- Se distinguen Gmail real, envío simulado y envío sin configurar. La cola solo
  exporta metadatos; no contiene cuerpo, destinatarios, tokens ni hashes de aprobación.
- Abrir una fila llega al trabajo exacto aunque no esté entre los primeros 50
  del Centro de agentes. El cliente rechaza una respuesta con otro id.
- El cursor está ligado a tenant/propietario, filtro, búsqueda, tamaño y snapshot.
  Si cambian los datos, responde `409 REVIEW_CURSOR_STALE`; la UI limpia y vuelve
  a consultar desde el principio. No conserva acciones sobre filas filtradas.
- Errores y sesión ausente limpian el listado. Un workspace configurado no se
  sustituye por una cola de ejemplo. Sin datos confirmados, los contadores son «—».
- Asuntos y nombres se muestran mediante `textContent`. No se interpreta HTML.
- Un efecto confirmado no basta para presentar el trabajo completado: el estado
  considera los pasos restantes del runtime, incluidos CRM y seguimiento.

## Arquitectura y autorización

`ReviewService` proyecta journal, revisiones, decisiones, bindings de correo,
efectos y resoluciones C12. Los lectores nuevos de EmailReviewStore y MailTaskStore
no añaden comandos ni alteran el formato de replay. Se conserva C1–C12.

API: `GET /v1/workspaces/<tenant>/review-queue`, con permiso `readRuntime` y
propietario derivado de la sesión. No admite propietario por query ni escrituras.
Filtro inicial `attention`, página inicial 25, máximo 50, búsqueda máximo 100.
Errores: 400, 401, 403, 404 sin configuración, 405 para método/ruta inválidos,
409 para cursor invalidado y 503 para journal no disponible.

Listar no consulta Gmail ni el modelo, no modifica CRM y no concede aprobación.
Los estados son hechos registrados: la cuenta, fuente, políticas y aprobación
exacta se comprueban al abrir/actuar con el workflow existente. Un cambio durable
de versión de plan bloquea la aprobación antigua en la proyección.

## Validación realmente ejecutada

- **10 pruebas nuevas** de P09, todas en verde: estados/privacidad, trabajo con
  correo confirmado pero pasos pendientes, paginación >50, scopes de cursor,
  búsqueda con tildes, contrato de cliente, aislamiento/auth, revisiones agrupadas,
  lectura sin efectos, restart/UNKNOWN/reconciliación sin duplicado, apertura exacta
  fuera de los primeros 50, cursor cambiado/journal cerrado y aprobación de plan antigua.
- **Monorepo: 917 pruebas descubiertas, 916 pasan, 0 fallos, 1 omitida** (Orca
  opcional). PYMES: **522 pasan**. Comando: `npm test`.
- `npm run typecheck --workspaces --if-present`: correcto.
- `npm run build`: correcto. Tras los últimos ajustes de presentación se recompila
  además PYMES. `git diff --check`: correcto.
- Navegador contra QA local aislado: **69 trabajos actuales**; páginas 25 → 50 →
  69; búsqueda limpia filas previas; apertura de `review-job-000` fuera del primer
  listado; un asunto `<img ...>` permanece texto y no crea ninguna imagen.
- Caída deliberada del servidor QA: error visible, filas retiradas, sin demo.
- QA no usa OAuth ni envía correos reales: modelo sintético y FakeEmailProvider.
  La prueba de reconciliación ejecutada en los tests conserva un único despacho.
- Piloto real 8907 reiniciado normalmente después de una copia SQLite consistente
  `backup-before-p09-runtime.db`, permisos 0600. La nueva cola conserva **4 trabajos**:
  **3 completados y 1 UNKNOWN legado**. No se reenvía el legado y no se realizan
  envíos nuevos ni análisis de correos personales en este incremento.

Captura: `/Users/mac/Downloads/AUTONOMO_OS_P09_REVISION_DEMO_2026-10-04.png`.
Muestra datos ficticios y envío simulado.

## Límites y próximo trabajo

- P09 no añade cancelación manual independiente. P08 permite retirar/corregir
  contenido mediante un sucesor antes de cualquier claim C6. La cancelación
  deliberada de pendientes sigue en el backlog y debe respetar esa misma barrera.
- No envía desde la lista, no aprueba en lote ni reenvía UNKNOWN. Abrir verifica
  el estado actual; los contadores no sustituyen esas comprobaciones.
- El nuevo recorrido completo P07/P08 necesita aceptación real contra Gmail con
  un correo entrante controlado y aprobación específica. M3 sigue cerrado; esta
  mejora no acredita por sí sola todo M4 ni el producto comercial.
- Pendientes: conversación/identidad y presentación de simulaciones en historial
  CRM; aceptación real M4; Calendar; canales; CRM externo; instalación firmada,
  recuperación/backup y operación comercial. Véase `docs/AUTONOMO_OS_PRODUCT_BACKLOG.md`.
