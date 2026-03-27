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

## Pendiente / próximas iteraciones

- **Pipeline real**: `pages/Pipeline/index.js` es un stub con `as any` en TypeScript falso — no hay board real en este path. Hay que identificar dónde está el pipeline real y migrarlo/mejorarlo.
- **TicketsSidebarAutos scroll infinito**: solo carga `pageNumber: 1`, no hay paginación ni scroll infinito.
- **Quotations window.confirm**: el `remove()` usa `window.confirm()` — reemplazar por modal de confirmación propio.
- **LoggedInLayout sidebar**: el drawer sigue siendo MUI puro. Candidato a migración futura.
- **Filtros de tickets**: los `<select>` nativos del sidebar no siguen el estilo del design system (usan `bg-auto-panel2` pero podrían ser más accesibles).
- **Pipeline/index.js `as any`**: hay un `{} as any` que sugiere que alguien copió TypeScript en un archivo .js — hay que reescribir ese archivo completo.
