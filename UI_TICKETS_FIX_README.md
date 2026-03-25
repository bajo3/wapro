# Tickets UI/UX fix v6

Commit sugerido:
`fix(tickets): unify ticket workspace design and modernize lead drawer`

## Qué cambia
- Unificación visual del workspace de Tickets (header, sidebar y detalle).
- Acciones del chat en una sola fila horizontal scrolleable para evitar que se rompa el header.
- Sidebar de tickets más claro y consistente con estados, búsqueda y filtros.
- Cards de tickets más legibles.
- Panel de gestión moderno con `SlideOver + LeadPanelAutos` en vista avanzada.
- Ajustes visuales en el listado de mensajes para mejorar contraste, espaciado y lectura.
- Fix adicional: al tomar tickets desde cola ahora se envía `userId` del operador actual.

## Validación hecha
- Chequeo sintáctico de los archivos modificados con `tsc --noEmit`.

## Nota
- No agrega variables de entorno nuevas.
