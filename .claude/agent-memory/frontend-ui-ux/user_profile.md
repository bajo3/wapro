---
name: WaPro Frontend Context
description: Stack, estructura y contexto del proyecto WaPro CRM automotriz
type: user
---

WaPro es un CRM automotriz usado por equipos comerciales de agencias de autos en Argentina (precios en ARS/USD).

**Stack frontend:**
- React (JSX, sin TypeScript)
- Tailwind CSS con tokens custom en `tailwind.config.js` — prefijo `auto-` para el tema oscuro
- Material-UI v4 (legacy, todavía en uso en algunos componentes como Quotations, Settings)
- clsx / lucide-react
- react-router-dom v5 (useHistory, useParams)
- date-fns, react-toastify

**Ubicación:**
`apps/panel-whaticket/frontend/src/`

**Módulos principales:**
- `pages/Tickets/TicketsAutos.jsx` — shell de tickets con sidebar resizable
- `components/TicketsSidebarAutos.jsx` — lista de tickets con tabs (Cola/Trabajando/Cerrados)
- `components/TicketsHeaderAutos.jsx` — header del módulo de tickets
- `components/TicketListItemTailwind.jsx` — card de ticket en la lista
- `components/ImprovedTicketChat.jsx` — panel de chat con acciones del ticket
- `components/LeadPanelAutos.jsx` — ficha lateral de datos comerciales del lead
- `pages/Pipeline/index.js` — STUB, no es el board real (ver pipeline service)
- `pages/Quotations/QuotationsManager.jsx` — gestión de cotizaciones (era MUI puro, migrado a tokens WaPro en mar-2026)
- `layout/index.js` — LoggedInLayout con sidebar MUI + AppBar

**Design tokens:**
- `src/styles/wapro-design-tokens.css` — variables CSS globales
- `tailwind.config.js` — extensiones Tailwind con colores `auto-*`, `ticket-*`, radii `auto-*`

**Tema:** oscuro (`auto-surface: #0f1117`, `auto-panel: #171b26`, accent amber `#f59e0b`)
