# Arquitectura inicial de PYMES

## Límite del primer prototipo

`src/domain.ts` es una proyección de planificación. Recibe mensajes y agenda,
elimina duplicados por `(canal, id de origen)`, asocia contactos, ordena casos y
prepara borradores. La clasificación de los datos de muestra está etiquetada
como `demo_fixture`: no se presenta como una inferencia de IA. La función no
posee ningún cliente de red ni método de envío. `src/main.ts` solo muestra
esa proyección y permite marcar borradores para revisión en memoria local.

`src/connectors.ts` añade dos operaciones de lectura independientes de la UI:
búsqueda exacta de un contacto en Holded por teléfono y listado acotado de
eventos con hora en Google Calendar. Reciben credenciales desde un llamador
de servidor; no las almacenan ni las incluyen en la URL. Devuelven modelos
externos sin asociarlos automáticamente con una persona del CRM. Una página
incompleta de Calendar se informa como error, y los eventos de día completo
quedan fuera hasta diseñar su representación. No hay flujo OAuth, almacén de
tokens ni cuentas conectadas en esta versión.

## Integración prevista con el kernel

| Paso | Recurso/control | Resultado exigido |
| --- | --- | --- |
| Leer un canal | C2 recurso de bandeja, C9 flujo de datos | Mensaje con origen y permisos comprobados |
| Asociar identidad | C1 sesión, CRM de solo lectura | Coincidencia verificable o revisión humana |
| Clasificar y redactar | H3 inferencia local, C8 composición | Propuesta trazable, sin autoridad propia |
| Cotizar | Catálogo y tarifador registrados | Datos completos; precio y cobertura provenientes del proveedor |
| Enviar mensaje | C11 control, C6 efecto, C5 observación | Aprobación humana, idempotencia y entrega confirmada |
| Crear cita o cambiar CRM | C11, C6, C7 reconciliación | Escritura autorizada y verificada; sin reintento ciego |

## Reglas del producto

- Los mensajes, documentos de pólizas y datos de clientes son sensibles. La
  interfaz de operador debe mostrar solo lo necesario para el trabajo.
- Una clasificación o un borrador nunca constituyen aprobación. El humano
  decide antes de enviar, modificar una póliza, cotizar o reservar una cita.
- No se fabrican primas, coberturas, exclusiones ni condiciones contractuales.
  Una propuesta requiere datos verificados y respuesta de un producto autorizado.
- Si un proveedor deja incierta una escritura, el sistema consulta su estado
  antes de repetirla. La respuesta del ejecutor no basta como prueba.
- Cada conector real necesita revisión de acceso, trazabilidad, retención y
  reglas de tratamiento de datos del país y de la agencia antes del piloto.

## Orden recomendado de implementación

1. Importación de correo y calendario en un entorno de prueba, de solo lectura.
2. Identidad/contactos y bandeja diaria con corrección humana de clasificación.
3. Borradores y aprobación explícita dentro de PYMES.
4. Una escritura gobernada: crear o actualizar una actividad en el CRM y
   comprobar su resultado.
5. Respuesta a un canal autorizado, con pruebas de idempotencia y fallo ambiguo.
6. Propuestas conectadas a datos de producto y tarifadores verificables.

La disponibilidad y condiciones de conectores de WhatsApp, Telegram e iMessage
deben verificarse para los sistemas concretos de la agencia. El prototipo no
asume acceso a cuentas personales ni a conversaciones existentes.
