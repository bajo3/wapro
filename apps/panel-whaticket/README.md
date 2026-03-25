# WaPro UI Overhaul — Instrucciones de instalación

## Archivos incluidos

```
frontend/
├── tailwind.config.js              ← Reemplaza el existente
└── src/
    ├── pages/
    │   ├── Bot/
    │   │   └── index.js            ← Panel del bot (ya instalado)
    │   └── Quotations/
    │       └── QuotationsManager.jsx
    └── components/
        ├── TicketListItemTailwind.jsx
        ├── TicketsSidebarAutos.jsx
        ├── TicketsHeaderAutos.jsx
        └── LeadPanelAutos.jsx
```

## Pasos

### 1. Tailwind config (IMPORTANTE — hacer primero)
```bash
cp frontend/tailwind.config.js apps/panel-whaticket/frontend/tailwind.config.js
```
Este archivo agrega los tokens del tema oscuro (`auto-surface`, `auto-panel2`, etc.)
Si no lo reemplazás, los componentes van a mostrar estilos rotos.

### 2. Componentes
```bash
cp frontend/src/components/TicketListItemTailwind.jsx  apps/panel-whaticket/frontend/src/components/
cp frontend/src/components/TicketsSidebarAutos.jsx     apps/panel-whaticket/frontend/src/components/
cp frontend/src/components/TicketsHeaderAutos.jsx      apps/panel-whaticket/frontend/src/components/
cp frontend/src/components/LeadPanelAutos.jsx          apps/panel-whaticket/frontend/src/components/
```

### 3. Páginas
```bash
cp frontend/src/pages/Bot/index.js  apps/panel-whaticket/frontend/src/pages/Bot/index.js
```

### 4. Reiniciar frontend
```bash
cd apps/panel-whaticket/frontend
npm run dev
```

## Cambios de diseño

| Componente | Cambio |
|---|---|
| `tailwind.config.js` | Tokens oscuros: `auto-surface=#0f1117`, `auto-panel=#171b26`, `auto-accent=#f59e0b` |
| `BotPanel` | Rediseño completo con tabs: Estado / Stock / Playground / Reglas |
| `TicketListItemTailwind` | Dark theme, badges de lead source con color, unread counter mejorado |
| `TicketsSidebarAutos` | Sidebar oscuro con search inline, icono de filtros, skeleton loading |
| `TicketsHeaderAutos` | Header compacto con dot de estado por tab |
| `LeadPanelAutos` | Ficha de lead con badges de stage/interés con colores, notas mejoradas |

## Diseño unificado

Todos los componentes usan el mismo sistema de colores oscuro:
- Fondo: `#0f1117`
- Paneles: `#171b26` / `#1e2333`  
- Acento: `#f59e0b` (amber)
- Open: `#22c55e` (verde)
- Pending: `#f59e0b` (amber)
- Texto: `#f1f5f9` / `#94a3b8` / `#64748b`
