# WaPro fix v7 — Tickets + Bot + Pipeline

## Commit sugerido
`feat(crm): seed auto-agency bot knowledge and streamline pipeline workflow`

## Incluye
- **Tickets UI/UX**: integración del fix visual v6 en la vista autos, lista, toolbar del chat y panel lateral.
- **Bot / Reglas y FAQs**:
  - botón **"Instalar base agencia"**
  - presets comerciales para agencia de autos
  - cobertura visual de áreas clave: stock, financiación, permuta, ubicación, horarios y test drive
  - formularios más rápidos para cargar reglas y FAQs
- **Pipeline**:
  - rediseño visual oscuro consistente con el resto del panel
  - filtros persistentes
  - búsqueda por contacto/ticket/estado
  - ventana temporal configurable
  - ocultar etapas vacías
  - filtros de leads con valor / leads fríos
  - métricas comerciales y alertas de seguimiento
  - movimiento rápido entre etapas sin depender solo de drag & drop
  - modal de etapas más claro

## Variables de entorno
No agrega variables nuevas.

## Archivos modificados
- apps/panel-whaticket/frontend/src/pages/Bot/index.js
- apps/panel-whaticket/frontend/src/pages/Pipeline/index.js
- apps/panel-whaticket/frontend/src/pages/Tickets/TicketsAutos.jsx
- apps/panel-whaticket/frontend/src/components/Ticket/index.js
- apps/panel-whaticket/frontend/src/components/MessagesList/index.js
- apps/panel-whaticket/frontend/src/components/TicketsHeaderAutos.jsx
- apps/panel-whaticket/frontend/src/components/TicketsSidebarAutos.jsx
- apps/panel-whaticket/frontend/src/components/TicketListItemTailwind.jsx
- apps/panel-whaticket/frontend/src/components/ImprovedTicketChat.jsx

## Validación hecha
Chequeo sintáctico con `tsc --noEmit --allowJs --jsx react --noResolve` sobre todos los archivos modificados.
