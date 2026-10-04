# Actualización UI/UX Autónomo OS — 2026-10-04

Base previa: d4d173ad85182e2df645d43a0291e33f28ac8d48.

## Cambios

- Shell con sidebar clara, navegación agrupada, iconos SVG coherentes, identidad de espacio, breadcrumb y buscador de secciones.
- Inicio compacto: indicadores de demostración, operativa remota separada, accesos al trabajo y agenda. Se reducen bloques repetidos del inicio.
- Estilos compartidos para bandeja, ficha de clientes, controles, tarjetas, agenda, ajustes y Centro de agentes en professional.css. Importada por main.ts, con reglas de pantalla para conservar impresión.
- Navegación móvil desplegable y accesible; Escape cierra el menú. Enlaces indican la sección activa; foco y scroll se restablecen al navegar. Enlace para saltar al contenido sin cambiar ruta.
- Centro de agentes: plan, evidencia/auditoría e historial en desplegables. En trabajos completados el plan se pliega. Destinatario, contenido y resultado siguen visibles; handlers de revisión, aprobación, ejecución y reconciliación conservados.
- Contadores locales de demo ya no se sobrescriben con cifras remotas. Los indicadores del servicio conectado siguen en su panel independiente.
- Filtro de bandeja: selecciona un mensaje visible cuando cambia el filtro; sin resultados limpia el detalle para impedir acciones sobre un mensaje ajeno al filtro.

## Verificación ejecutada

`npm run check --workspace=@agent-world/pymes`: typecheck correcto, 373 tests pasan, build correcto. Revisión visual del navegador real: inicio, ficha de cliente y búsqueda, filtro Correo, búsqueda sin resultados, buscador global, navegación móvil a 390×844, Centro de agentes real y apertura de evidencia. Inicio y Centro de agentes móvil: scrollWidth=390 para viewport=390.

Captura: /Users/mac/Downloads/AUTONOMO_OS_UI_INICIO_2026-10-04.jpg.

## Compatibilidad P03

Claude puede entregar P03 sobre d4d173a y el paquete de fuentes ya enviado. Cambios de esta actualización: pymes/index.html, src/main.ts, src/navigation.ts, src/runtime-screen.ts y src/professional.css (nuevo). No cambian contratos del backend, OAuth, stores, Gmail provider, gobernanza ni tests de P03. Si la entrega modifica estos archivos UI, Codex resolverá los parches contra ambas bases; no sobrescribir cambios ni regenerar el paquete original silenciosamente.

M4 Inbox/CRM no se implementa en esta actualización. Clientes, agenda y bandeja conservan datos de ejemplo identificados; Gmail real se opera desde Centro de agentes. La dirección de la interfaz toma como referencia la organización de apps de gestión como Holded, con diseño propio.
