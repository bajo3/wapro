# Fix review — 2026-04-02

## Hallazgos corregidos

### 1) Pipeline no reflejaba bien mensajes y cambios en vivo
- El tablero no estaba suscripto a `notification` ni a los rooms de tickets.
- Resultado: mensajes nuevos, cambios de contacto, limpieza de conversación y updates de ticket no se reflejaban bien en Pipeline.
- Fix: se agregó sincronización por socket para `ticket`, `appMessage` y `contact`.

### 2) Tickets podían desaparecer del pipeline por antigüedad
- `GET /pipeline/board` filtraba por `updatedAt >= cutoff`.
- Resultado: tickets viejos pero todavía asignados a una etapa podían dejar de verse.
- Fix: ahora el board incluye todos los tickets que tengan `pipelineStageId` y además mantiene el lookback para tickets recientes.

### 3) Limpiar conversación no notificaba al canal global
- `clearConversation` emitía update al room del ticket y al status, pero no a `notification`.
- Resultado: vistas globales como Pipeline podían quedar con preview viejo.
- Fix: ahora también emite a `notification`.

### 4) Cotización desde ficha comercial con query params mal codificados
- `LeadPanelAutos` aplicaba `encodeURIComponent` manual antes de `URLSearchParams`.
- `QuotationsManager` luego intentaba `decodeURIComponent` otra vez.
- Resultado: doble encoding y riesgo de `URI malformed` con `%`, espacios o acentos.
- Fix: se eliminó el encode/decode manual y se dejó que `URLSearchParams` maneje el encoding.

## Archivos modificados
- `apps/panel-whaticket/frontend/src/pages/Pipeline/index.js`
- `apps/panel-whaticket/frontend/src/components/LeadPanelAutos.jsx`
- `apps/panel-whaticket/frontend/src/pages/Quotations/QuotationsManager.jsx`
- `apps/panel-whaticket/backend/src/controllers/PipelineController.ts`
- `apps/panel-whaticket/backend/src/controllers/TicketController.ts`
