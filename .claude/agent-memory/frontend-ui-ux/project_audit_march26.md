---
name: Auditoría UI/UX — Marzo 2026
description: Pain points detectados e implementados en la auditoría del 2026-03-26
type: project
---

**Why:** Primera auditoría profunda del panel CRM. El proyecto tenía inconsistencia visual severa entre módulos (MUI puro vs Tailwind+tokens), estados de status en inglés crudo, botones sin jerarquía y un design system incompleto.

**How to apply:** Referencia para saber qué quedó resuelto y qué todavía está pendiente de próximas iteraciones.

## Cambios implementados

### 1. `pages/Quotations/QuotationsManager.jsx`
- Tabla MUI reemplazada por tabla HTML nativa con tokens WaPro dark
- Status badges con colores semánticos: Borrador/Enviada/Aceptada/Rechazada (ya no en inglés crudo)
- Header con título + botón primario alineados
- Barra de búsqueda con ícono SVG inline, contador "X de Y cotizaciones"
- Skeleton loading (4 filas animadas)
- Empty state con ícono + mensaje contextual según si hay búsqueda activa o lista vacía
- Dialog del formulario con fondo oscuro y tokens WaPro, labels en español, textarea nativa
- Botones del dialog con estilos correctos (cancelar neutral, guardar amber)
- Imports MUI reducidos: solo Dialog/DialogActions/DialogContent/DialogTitle/CircularProgress

### 2. `components/TicketsHeaderAutos.jsx`
- Botón "Limpiar filtros" ahora es condicional — solo aparece cuando `hasActiveFilters === true`
- Cuando aparece, es amber outline (no background sólido) para ser menos agresivo visualmente
- "Refrescar" renombrado a "Actualizar" con title tooltip

### 3. `components/ImprovedTicketChat.jsx`
- Barra de acciones reorganizada con separador visual entre primarias y secundarias
- "Vista clásica" y "Refrescar" movidos al extremo derecho como acciones discretas (solo ícono, sin etiqueta)
- "Rápidos" cambió de `bg-auto-accent text-white` a `bg-auto-accent/15 text-auto-accent` (más sutil activo)
- "WA" acortado para ahorrar ancho; "Cotización" → "Cotizar"
- Bot badge diferenciado: azul cuando `isHumanOnly`, gris sutil cuando está en auto

### 4. `components/LeadPanelAutos.jsx`
- `SectionLabel` subió de 10px a 11px con tracking mejorado
- `Card` padding de `p-3` a `p-3.5` para mayor respiración
- Header rediseñado: eyebrow "Lead" + título "Ficha comercial", badge de leadSource con pill
- Error state reemplazado por bloque con ícono + mensaje + indicación de acción
- Skeleton loading amplió a 4 items (antes 3) para mejor fill visual

### 5. `components/TicketListItemTailwind.jsx`
- Botón "Tomar" de `h-9` a `h-8` para mayor proporción dentro del card
- Padding del botón ajustado a `pr-2.5` (antes `pr-3`)

### 6. `components/TicketsSidebarAutos.jsx`
- Eyebrow "Tickets" → "CRM", título "Gestión comercial" → "Bandeja de tickets"
- Contador cambiado de "X en vista" a "X resultado(s)" (solo visible cuando no está cargando)

### 7. `layout/index.js`
- AppBar title corregido: "WhaTicket" → "WaPro"

### 8. `tailwind.config.js`
- Agregado: `auto-panel3`, `auto-danger`, `rounded-auto-sm`, `rounded-auto-2xl`
- Agregado: `shadow-auto-xs`, `shadow-auto-glow`

### 9. `src/styles/wapro-design-tokens.css`
- Ampliado con: `--wapro-panel3`, `--wapro-info`, `--wapro-r-xs`, `--wapro-shadow-xs`, `--wapro-glow`, escala `--sp-*`
- Nuevas clases utilitarias: `.wapro-card-sm`, `.wapro-btn-primary`, `.wapro-badge-*` (todos los estados), `.wapro-section-label`, `.wapro-scroll`

## Cambios 2026-03-26 (segunda sesión)

### 10. `pages/Pipeline/index.js` — reescritura completa (P0)
- Era un stub con `{} as any` y handlers vacíos. Reescrito como componente funcional real.
- Carga stages y tickets desde `GET /pipeline/board`
- Mover ticket: botón "Mover a [etapa]" en cada card → `PUT /pipeline/tickets/:id/stage`
- Optimistic update: mueve el ticket en estado local antes de la respuesta; rollback con `fetchBoard()` si el PUT falla
- Vista Foco (una columna a la vez, full width) y Vista Kanban (scroll horizontal, columnas fijas 320px)
- Preferencia de vista guardada en `localStorage.pipelinePrefs.viewMode`
- Estados de carga (skeleton), error (con retry) y vacío correctos
- Sin nueva dependencia DnD — se usaron botones de mover

### 11. `components/LeadPanelAutos.jsx` — stages dinámicos
- Hook `usePipelineStages()` carga stages desde `GET /pipeline/stages` una sola vez (guarded con `useRef`)
- Fallback a `STAGES_FALLBACK` si el endpoint falla (sin toast, sin romper UI)
- Select de etapa usa `dynamicStages` (stages del backend) en lugar de la constante hardcodeada
- Badge de etapa activa también lee de `dynamicStages`
- `setStage()` ahora: (1) optimistic update de tags localmente, (2) persiste tags en backend, (3) si el stage tiene id numérico, llama `PUT /pipeline/tickets/:ticketId/stage` para mantener el board sincronizado

## Cambios 2026-03-26 (tercera sesión — cotizaciones vinculadas + validUntil)

### 12. `pages/Quotations/QuotationsManager.jsx` — ticketId + validUntil
- `emptyForm` ampliado con `ticketId: ""` y `validUntil: ""`
- Import de `differenceInHours`, `parseISO` (date-fns) y `useLocation`, `useHistory` (react-router-dom v5)
- `openCreate(overrides)` acepta overrides para pre-cargar formulario desde LeadPanel
- `useEffect` al montar: lee query params `ticketId`, `contactId`, `contactName`, `vehicleLabel`, `price` — abre dialog pre-cargado y limpia la URL con `history.replace`
- `openEdit` rellena `ticketId` y `validUntil` desde datos del servidor
- Payload del `save` incluye `ticketId` (como número si posible) y `validUntil`
- Tabla: nueva columna "Vence" con badge rojo si `hours < 0`, amber si `hours < 48`, texto neutro si no
- Tabla: nueva columna "Ticket" con link `#ticketId` → `/tickets/:id`
- Formulario: campo `<input type="date">` "Válida hasta" con `colorScheme: dark`
- Formulario: campo "Ticket vinculado (ID)" text input (editable manualmente si no vino de redirect)

### 13. `components/LeadPanelAutos.jsx` — botón Cotizar + sección cotizaciones
- Import `useHistory` (react-router-dom v5)
- Estado `quotations`, `quotationsLoading` para las cotizaciones del ticket
- `useEffect` que hace `GET /quotations?ticketId=X` (best-effort, sin toast si falla para no romper cuando el campo no existe aún)
- `goToNewQuotation()`: navega a `/quotations?ticketId=X&contactId=Y&contactName=...&vehicleLabel=...&price=...`, leyendo datos del bot desde tags KVP (`vehicle:`, `vehiculo:`, `budget:`, `presupuesto:`)
- Header: botón "Cotizar" amber visible solo cuando el ticket está cargado
- Nueva card "Cotizaciones" entre Tags y Notas: lista compacta de cotizaciones con ID, vehículo, precio, badge de estado; botón "+ Nueva" inline

## Pendiente / próximas iteraciones

- **TicketsSidebarAutos scroll infinito**: solo carga `pageNumber: 1`, no hay paginación ni scroll infinito.
- **Quotations window.confirm**: el `remove()` usa `window.confirm()` — reemplazar por modal de confirmación propio.
- **LoggedInLayout sidebar**: el drawer sigue siendo MUI puro. Candidato a migración futura.
- **Filtros de tickets**: los `<select>` nativos del sidebar no siguen el estilo del design system.
- **Pipeline — filtros y búsqueda**: el board nuevo no tiene filtro por contacto/etapa ni búsqueda. Se puede agregar en iteración siguiente.
- **Pipeline — STAGE_COLOR dinámico**: el `STAGE_COLOR` en LeadPanelAutos es estático (slugs hardcodeados). Si el backend retorna stages con `color` hex, conectarlo también al badge.
