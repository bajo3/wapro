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

## Cambios 2026-03-27 — Chat de tickets: legibilidad y layout

### `components/MessagesList/index.js`
- Colores de burbujas rediseñados: cliente = `#1e2840` azul oscuro, operador = `#0f3020` verde oscuro, bot = `#1a1535` púrpura oscuro
- Badge "Bot" diferenciado con fondo y borde púrpura (`#a78bfa`) — antes era gris neutro indistinguible
- Nuevo estilo `messageBotLeft`: burbujas del bot van alineadas a la izquierda (antes iban a la derecha igual que el operador), lo que facilita la lectura del flujo
- Padding del texto cambiado de `padding: "10px 80px 12px 12px"` a `padding: "10px 12px 28px 12px"` — elimina el exceso de padding derecho que aplastaba el contenido, el timestamp ahora flota limpio en el corner inferior
- Timestamp: opacidad subida de 0.40 a 0.52, gap entre hora y ack icon
- `scrollToBottom` mejorado: usa `{ behavior: "smooth", block: "end" }` — antes usaba `{}` y podía saltar de golpe
- `scrollBehavior: "smooth"` agregado al contenedor `messagesList`
- Detección de bot ampliada: antes solo `id.startsWith("bot-")`; ahora también chequea `message.fromBot === true` y `message.agent === true`
- Estado vacío: antes retornaba `[]` (nada), ahora muestra mensaje de texto con `ref={lastMessageRef}` para que el ancla de scroll funcione
- Render principal: `{messagesList.length > 0 ? renderMessages() : []}` reemplazado por `{renderMessages()}` para que el estado vacío siempre se muestre
- Separador de día: margen subido a 14px, fuente 11px uppercase tracking

### `components/ImprovedMessageInput.jsx`
- Auto-resize del textarea: `handleAutoResize()` ajusta la altura al contenido (máx 160px) al escribir y al recibir prefill
- `style={{ resize: "none" }}` — eliminado el resize manual que era inconsistente con el auto-resize
- Placeholders informativos: `"pending"` → "Tomá el ticket para responder"; `"closed"` → "Ticket cerrado — reabrilo para responder"; `"open"` → hint de Shift+Enter
- `overflow-y-auto` en lugar de `resize-y` para scroll interno cuando hay mucho texto

### `components/ImprovedTicketChat.jsx`
- Header colapsado de dos filas a una sola fila compacta (py-3 → py-2)
- Info del contacto: nombre + badge de estado semántico (verde = open, ámbar = pending, gris = closed) + teléfono en `font-mono` inline
- Estado badge con colores semánticos por statusKey (antes todos iguales `bg-auto-surface`)
- Acciones en barra scrollable horizontal dentro del header — ya no expanden el header verticalmente
- Iconos de botones reducidos a h-3.5 w-3.5, altura h-8 (antes h-9)
- Labels de acciones colapsados en mobile con `hidden sm:inline` para no perder ancho en pantallas chicas
- Quick replies: compactado a una sola línea (py-1.5), se eliminó el texto "Clic en un chip..." para ganar espacio
- Chips de quick replies con hover animado hacia el accent color

## Cambios 2026-03-27 — Cotizaciones: mejoras comerciales y visuales

### `pages/Quotations/QuotationsManager.jsx`
- Precio destacado en tabla: badge de moneda con color semántico (ARS = sky azul, USD = emerald verde) + número en `text-[15px] font-bold tabular-nums` — antes era texto plano muted
- Vehículo con jerarquía: título en bold blanco, subtexto año/versión en muted debajo — antes todo era un solo string gris
- Eliminada columna "Actualizado" para reducir scroll horizontal (8 columnas en lugar de 9)
- Acciones contextuales por estado: draft → "Enviar" (amber), sent → "Consultar" (blue), accepted → "Ver deal" (green). Antes siempre aparecían Editar/Enviar/Eliminar independientemente del estado
- Botón "Eliminar" ahora solo visible en draft y rejected (no en sent/accepted para evitar borrado accidental de deals activos)
- Nuevo botón icono WA (SVG inline, sin deps) por fila: copia texto formateado al portapapeles con fallback execCommand para contextos sin permisos de clipboard
- Función `buildWhatsAppText(q)`: genera texto con negrita WhatsApp (`*Precio: ...*`), separadores, cliente, vehículo, precio con moneda, vigencia y notas
- Formulario dialog reorganizado en 4 secciones con separadores visuales: Identificacion / Cliente / Vehículo / Precio / Condiciones
- Preview de precio en tiempo real dentro del header de sección "Precio" — muestra moneda + monto formateado al tipear
- `lookupLoading` movido al header de sección Cliente (más contextual)
- Placeholder de notas actualizado: "Forma de pago, descuentos acordados, condiciones especiales..." (antes "Condiciones especiales, descuentos acordados...")
- Label "Notas" mejorado con aclaración inline "(no se envian al cliente)"

## Pendiente / próximas iteraciones

- **Pipeline real**: `pages/Pipeline/index.js` es un stub con `as any` en TypeScript falso — no hay board real en este path. Hay que identificar dónde está el pipeline real y migrarlo/mejorarlo.
- **TicketsSidebarAutos scroll infinito**: solo carga `pageNumber: 1`, no hay paginación ni scroll infinito.
- **Quotations window.confirm**: el `remove()` sigue usando `window.confirm()` — reemplazar por modal de confirmación propio.
- **LoggedInLayout sidebar**: el drawer sigue siendo MUI puro. Candidato a migración futura.
- **Filtros de tickets**: los `<select>` nativos del sidebar no siguen el estilo del design system (usan `bg-auto-panel2` pero podrían ser más accesibles).
- **Pipeline/index.js `as any`**: hay un `{} as any` que sugiere que alguien copió TypeScript en un archivo .js — hay que reescribir ese archivo completo.
