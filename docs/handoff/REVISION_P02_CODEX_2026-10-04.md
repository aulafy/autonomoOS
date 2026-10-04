# Revisión P02 — Codex — 2026-10-04

Base: 17cabf31f077286ad64e24f9dbf8e4e8dc9b96d4.

Entrega integrada tras verificar hashes y aplicación limpia. Sin cambios C1–C12, Keychain, OAuth, P01 ni workflow. Nuevo marcador v2 y escaneo SENT preservan verificación completa y cero segundo POST. Claims antiguos conservan identidad v1; A original continúa UNKNOWN y no se reenvía.

## Correcciones de revisión

- El fallo de un poll obsoleto no llama markError sobre una conexión posterior. Test determinista controla el orden, sin depender del sleep.
- Cuenta publicada procede de la misma credencial que el binding.
- Presupuesto validado antes de abrir ledger, copiado para impedir mutación externa. Máximos 100/página, 5 páginas, 200 lecturas y 24h previas.
- Tokens o IDs repetidos y drift en páginas impiden probar unicidad.
- Raw ilegible, demasiado grande o sin separador MIME se trata como unverifiable. No puede ocultarse como no_match tras encontrar otra coincidencia.
- Versiones desconocidas en ledger no se interpretan como legacy.

## Verificación

63 tests dirigidos originales tras aplicar entrega: pasan, incluidos SIGKILL P01. Suite monorepo: 764 tests, 763 pasan, 0 fallos, 1 omitido opcional Orca. Typecheck y build completos pasan. Tras ajustes finales: check del workspace pymes (373 tests + typecheck + build) pasa. git diff --check limpio.

Gmail real (solo GET): listado labelIds=SENT + q=after:<epoch> devuelve HTTP 200, un mensaje y sin nextPageToken; contiene A original. Esto acredita aceptación del filtro y ese resultado, no todas las ventanas temporales ni unicidad global.

## Límites

La vía rápida por gmail_id prueba existencia de mensaje marcado y exacto, no ausencia global de duplicados. El escaneo completo solo establece una coincidencia en la colección listada; índices retrasados y cambios concurrentes limitan esa garantía. Ausencia o recorrido incompleto mantienen UNKNOWN; jamás habilitan reenvío.

Pendiente Gmail real: conservación del marcador en un envío nuevo A2 aprobado por el propietario; llegada A2 + efecto COMMITTED, B y C. M3 abierto, M4 no iniciado.
