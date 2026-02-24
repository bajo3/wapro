# WaPro (CRM + WhatsApp)

Stack multi-módulo (Railway-friendly) para operar WhatsApp multiagente con panel tipo Whaticket + bot de automatización.

## Módulos

- `apps/evolution-api`: Evolution API (sesiones, mensajes, webhooks).
- `apps/panel-whaticket/backend`: Backend del panel (API, auth, tickets, contactos, campañas, etc.).
- `apps/panel-whaticket/frontend`: Frontend del panel (React + MUI v4 + Vite + Tailwind para nuevas pantallas).
- `apps/bot`: Servicio de bot + automatizaciones (incluye Demand CRM + matching + recontacto).
- `apps/gateway-meta`: Gateway para integraciones con Meta (IG/FB).
- `apps/evolution-manager`: utilidades/admin.

## Quick start (dev)

1) Copiá y completá `.env` en cada servicio que uses (ver `.env.example` donde aplique).

2) Levantar en local con Docker (si usás el compose del repo):

```bash
docker compose -f docker-compose.dev.yml up -d
```

3) Frontend panel (local):

```bash
cd apps/panel-whaticket/frontend
npm install
npm run dev
```

4) Backend panel (local):

```bash
cd apps/panel-whaticket/backend
npm install
npm run dev
```

## Demand CRM (Pedidos de autos) + Recontacto

El bot implementa:

- **Demandas**: guardar pedidos de clientes (query + filtros).
- **Matching automático**: compara stock actualizado vs demandas.
- **Auto-notify**: cuando aparece match, envía WhatsApp con template.
- **Recontacto automático**: sigue al cliente cada X días hasta un máximo.

### Variables de entorno (apps/bot)

- `DEMAND_SCAN_MS` (default 5 min): frecuencia del scan de matching.
- `DEMAND_SCAN_LOOKBACK_MIN` (default 10): ventana de vehículos a comparar.
- `DEMAND_MATCH_THRESHOLD` (default 0.62): umbral mínimo de match.
- `RECONTACT_SCAN_MS` (default 10 min): frecuencia del job de recontacto.

### Templates

En el panel (CRM → Demandas) podés editar templates:

- **Match template**: `Variables: {name} {query} {title} {year} {price} {currency} {score} {url}`
- **Recontact template**: `Variables: {name} {query} {count}`

## Pipeline Kanban (Ventas)

En el panel tenés una vista Kanban para manejar el estado comercial del lead/ticket.

- Ruta: **/pipeline**
- Drag & drop de tickets entre etapas
- Métricas por etapa: cantidad, **tiempo promedio en etapa** (según `stageChangedAt`), **valor potencial** separado por ARS/USD (suma de `dealValue`)
- Edición rápida por ticket: `dealValue` + `dealCurrency`

### API (backend panel)

- `GET /pipeline/board` (por defecto trae últimos 120 días para performance)
- `GET /pipeline/stages`
- `POST /pipeline/stages`
- `PUT /pipeline/stages/:id`
- `DELETE /pipeline/stages/:id`
- `PATCH /pipeline/tickets/:ticketId/stage`
- `PATCH /pipeline/tickets/:ticketId/value`

### DB

Migraciones agregadas:

- Tabla `PipelineStages`
- Tabla `TicketStageHistories`
- Columnas en `Tickets`: `pipelineStageId`, `stageChangedAt`, `dealValue`, `dealCurrency`

Regla de negocio aplicada:

- Si el ticket se mueve a una etapa `WON` o `LOST` → `status` pasa a `closed`.
- Si se mueve a una etapa `OPEN` y estaba cerrado → vuelve a `open`.

## Optimización de rendimiento (Frontend)

- **Code-splitting** por rutas con `React.lazy`.
- El wrapper de rutas renderiza dentro de `Suspense` con fallback (`BackdropLoading`).
- Componentes de lista críticos (`TicketListItem`) memoizados para reducir re-render.

## Seguridad (Backend)

Sin agregar dependencias nuevas, el backend del panel aplica:

- Headers de seguridad básicos.
- Sanitización mínima para prevenir prototype-pollution.
- Guard CSRF simple para requests mutantes desde browsers (valida `Origin` contra `FRONTEND_URL`).
- Rate limiting (`generalLimiter`).

## Integración Panel ↔ Bot (Demands)

El backend del panel expone endpoints que **forwardean** a `apps/bot`:

- `GET /bot/demands`
- `POST /bot/demands`
- `PUT /bot/demands/:id`
- `POST /bot/demands/:id/close`
- `GET /bot/demands/:id/matches`
- `POST /bot/demands/scan`
- `POST /bot/demands/recontact/run`

Variables:

- `BOT_URL` (panel → bot)
- `BOT_ADMIN_TOKEN`
- `BOT_HTTP_TIMEOUT_MS` (default 15000)

---

### Commit sugerido para este paquete de mejoras

`chore(panel+bot): ux/perf/security pass + demands templates`
