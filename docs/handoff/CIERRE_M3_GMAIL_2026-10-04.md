# Cierre M3 Gmail — 2026-10-04

## Resultado

M3 aceptado para el piloto local dedicado. Base de código validada: `eedd517bbe32ef3263b8e225d40525c2dbefdac5`. M4 no iniciado.

## Validaciones reales

- **A2:** envío aprobado por el usuario mediante Governed Runner; efecto COMMITTED; recepción confirmada con captura de las 04:08:02.
- **B:** reinicio normal; autorización recuperada desde Keychain sin nuevo consentimiento; nuevo envío aprobado COMMITTED y recepción confirmada con captura de las 04:13:40.
- **C:** tarea `m3-c-20261004-041427`, asunto `M3-C-20261004-041427-P02`. Gmail aceptó; el harness descartó la respuesta; efecto UNKNOWN durable; helper aplicó SIGKILL al piloto (PID 47746); reinicio conservó UNKNOWN; reconciliation confirmó el efecto sin volver a ejecutar el envío. Recepción confirmada por el usuario con captura de las 04:15:59.
- C mantiene el estado histórico UNKNOWN y estado efectivo COMMITTED por confirmed_effect. El provider no tenía gmail_id en el claim. Existe un único claim y el recorrido completo de Enviados de la ventana consultada (una página, cuatro mensajes) encuentra exactamente una coincidencia de identidad y contenido. No se observó duplicado en esa ventana.

## Gates finales ejecutados

- `npm test`: 764 tests; 763 pasan; 0 fallos; 1 prueba opcional Orca omitida.
- `npm run typecheck --workspaces --if-present`: exit 0.
- `npm run build`: exit 0.
- Auditoría binaria y de celdas SQLite: ningún acceso/refresh token actual ni client secret en las bases/WAL del piloto, evidencias guardadas y logs examinados. Credencial disponible desde Keychain. Valores secretos procesados solo en memoria y no impresos.

## Límites y pendientes

- Esta aceptación corresponde a una cuenta Gmail dedicada y al piloto local; no acredita distribución pública ni verificación OAuth de Google.
- La auditoría comprueba valores secretos actuales en archivos especificados; no cubre tokens históricos indisponibles ni todo el ordenador.
- El correo A original anterior a P02 permanece UNKNOWN: carece del nuevo marcador y no se fuerza su aceptación ni se reenvía.
- Los pasos CRM del workflow de prueba siguen siendo fixtures; no equivalen a M4.
- La inyección C está consumida y el piloto vuelve a arrancar sin activación de fault injection.
- Estudiar posteriormente permisos mínimos (metadata + SENT + Message-ID), verificación pública OAuth y M4 Inbox + CRM local. No se implementan aquí.

## Próximo trabajo para Claude

M3 queda comunicado como aceptado. Preparar una propuesta M4 con interfaces reales, alcance y pruebas antes de implementar; esperar autorización para iniciar M4. Preservar C1–C12, aprobación exacta, Keychain y semántica UNKNOWN sin reenvío automático.
