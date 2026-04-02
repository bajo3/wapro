# Fix Pipeline + chat embebido

## Cambios
- Se corrigió el mapping del board: el backend ahora devuelve `stages` con `tickets` embebidos, además de `ticketsByStage`.
- El frontend del pipeline ahora soporta ambos formatos y no deja columnas vacías por lectura incorrecta.
- Se agregó panel lateral de conversación dentro de Pipeline para ver y responder mensajes sin salir del tablero.
- Las cards del pipeline ahora permiten seleccionar ticket y resaltan el ticket activo.
- Se corrigió el método HTTP de sincronización de etapa en `LeadPanelAutos` de `PUT` a `PATCH`.

## Alcance
Esto se suma al fix previo de recontacto y limpieza de conversaciones.
