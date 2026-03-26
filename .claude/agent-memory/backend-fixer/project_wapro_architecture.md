---
name: WaPro architecture
description: Arquitectura general del proyecto WaPro — apps, contratos y flujos críticos
type: project
---

WaPro es un CRM automotriz compuesto por tres apps:

- `apps/bot` — Bot WhatsApp (Node/TypeScript, ESM). Usa Evolution API. Servicios clave: `catalog.ts`, `agent.ts`, `gpt.ts`, `playground.ts`, `extract.ts`, `intelligence.ts`.
- `apps/panel-whaticket/backend` — API Node/Express + Sequelize + Postgres. Controllers en `src/controllers/`. Modelos Sequelize en `src/models/`.
- `apps/gateway-meta` — Webhooks Facebook/Instagram.

**Contratos frontend↔backend sensibles:**
- Vehículos: `{ vehicles: [{ id, marca, modelo, version, precio, currency, year, imageUrl }] }` — el campo `imageUrl` (no `image_url`) es el que espera el frontend.
- Cotizaciones: requieren `clientName` y `vehicleLabel` mínimo. `contactId` es opcional pero si se pasa se resuelve el nombre.
- Pipeline: stages tienen `{ id, name, category: OPEN|WON|LOST, order, isDefault }`. Tickets se mueven con `updateTicketStage`.
- Bot settings: `{ enabled: boolean }` — el backend debe aceptar tanto boolean como string.

**Flujo GPT del bot:**
`playground.ts` → `decideAgentAction` en `agent.ts` → `askGPTJson` en `gpt.ts` → OpenAI API.
El catálogo se serializa como texto compacto (máx 80 items) antes de pasar al contexto GPT.

**Base de datos:**
- Panel: Postgres vía Sequelize ORM (Railway o similar).
- Bot: pool directo a `public.vehicles` para el catálogo.
- VehiclesController detecta la tabla dinámicamente (autodetect + cache 60s).

**Why:** Entender esta arquitectura es esencial para no romper contratos entre las tres apps al hacer fixes.
**How to apply:** Antes de tocar un endpoint, verificar qué consume el frontend y qué produce el bot.
