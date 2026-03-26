---
name: Contexto del proyecto WaPro
description: Módulos existentes, estado técnico y foco del producto al 2026-03-26
type: project
---

WaPro es un CRM automotriz con los siguientes módulos confirmados (2026-03-26):

## Módulos frontend (pages/)
- Tickets (TicketsAutos.jsx — versión rediseñada, layout split con sidebar redimensionable)
- Pipeline (index.js — tiene vista focus + kanban, pero el archivo actual es stub/fragmento, no implementación completa)
- Quotations (QuotationsManager.jsx — lista + CRUD básico, sin vínculo directo a Ticket/Pipeline)
- Bot (index.js — panel rediseñado con FAQs, policies, playground)
- Contacts (index.js — estilo Material UI viejo, no alineado al diseño nuevo)
- Contacts/Demands (index.js — Material UI viejo, funcionalidad de demandas con match de stock)
- Dashboard (index.js — MUI puro, solo 3 contadores de tickets, sin métricas comerciales)
- Campaigns, Connections, Queues, QuickAnswers, Settings, Users, TrainingMessages

## Módulos backend (controllers/)
- TicketController, PipelineController, QuotationsController
- VehiclesController (auto-detecta tabla de stock, best-effort)
- BotSettingsController, TrainingMessagesController
- CampaignsController, ScheduledMessagesController
- ContactController (incluye CSV import)
- TicketNotesController, TicketTagsController
- ApiController, EvolutionWebhookController, MetaWebhookController

## Modelos de datos relevantes
- Ticket: tiene pipelineStageId, stageChangedAt, dealValue, dealCurrency, botMode
- Quotation: tiene contactId, vehicleData (JSONB), financing/tradeIn (JSONB), validUntil, sentAt
- PipelineStage: name, category (OPEN/WON/LOST), order, isDefault
- TicketStageHistory: existe el modelo (trazabilidad de movimientos)

## Estado del diseño
- Módulos nuevos usan Tailwind (dark theme, tokens auto-*)
- Módulos viejos usan Material UI (Contacts, Demands, Dashboard, Settings)
- Hay inconsistencia visual importante entre módulos

## Contexto de sesión previa
- Bot mejorado: agent.ts v5, gpt.ts v5, reglas MOSTRAR vs PREGUNTAR, intenciones implícitas
- Backend: bugs críticos corregidos (decideAgentAction era stub, pipeline/quotations/tickets/bot-settings)

**Why:** Tener este mapa claro permite al PO priorizar sin pedir contexto en cada sesión.
**How to apply:** Usar para evaluar qué módulo necesita más trabajo, qué está bloqueado y dónde hay deuda técnica visible.
