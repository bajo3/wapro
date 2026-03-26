---
name: WaPro Training System — Estado actual
description: Estado del sistema de entrenamiento del bot automotriz de WaPro, incluyendo qué existe, qué se mejoró y qué falta
type: project
---

El bot de WaPro atiende leads automotrices por WhatsApp para una agencia en Tandil, Buenos Aires.

**Arquitectura de conocimiento:**
- FAQs, policies y playbooks viven en PostgreSQL (tablas: bot_faq, bot_policies, bot_playbooks)
- Se cargan via admin UI o migraciones SQL en `apps/bot/sql/`
- El motor de matching usa trigger-scoring con normalización de texto (intelligence.ts)
- Los prompts del agente están en `apps/bot/src/services/agent.ts` (buildAgentSystemPrompt v5) y `gpt.ts` (buildCarDealershipSystemPrompt v5)
- El agente principal usa GPT via askGPTJson con sistema JSON estructurado

**Migraciones SQL existentes:**
- 005_seed_botpanel_v2.sql — políticas base (permuta, financiación, stock), FAQs (horarios, ubicación, requisitos), playbooks (usado, financiacion, stock, ubicacion), 24 test cases
- 011_faq_mejorado.sql — actualiza triggers de horarios y ubicación, agrega FAQ precio general
- 012_training_v2.sql — NUEVO (2026-03-26): 5 policies nuevas, 8 FAQs nuevas, 5 playbooks nuevos, 7 ejemplos, 14 test cases

**Lo que agregó 012_training_v2.sql:**

Policies nuevas:
- No inventar precios ni stock (regla con criterio claro de qué hacer cuando falta info)
- No repetir datos ya conocidos (contexto entre turnos)
- Máximo 3 opciones sin filtrar
- Derivación a asesor humano (cuándo exactamente derivar)
- Precios con/sin IVA (cómo manejar la pregunta)

FAQs nuevas:
- Financiación - cómo funciona
- Cuota estimada
- Permuta - aceptan usado
- Precio final / IVA
- Visita - cómo ir a ver el auto
- Reserva - cómo apartar un auto
- Garantía del vehículo
- GNC - vehículos con gas
- Test drive

Playbooks nuevos:
- compra_directa (intent=compra_directa, action=ESCALATE_HUMAN)
- comparacion (intent=comparacion, pedir priority antes de recomendar)
- indecision (intent=indecision, preguntar uso+presupuesto+caja)
- visita (intent=visita, action=SCHEDULE_VISIT)
- cierre_frio (intent=cierre_frio, action=KEEP_WARM)

**Lo que mejoró en los prompts TypeScript:**

agent.ts (buildAgentSystemPrompt):
- Agregadas reglas para indecisión, comparación, cierre frío, GNC, garantía, test drive, reserva, precio IVA
- Agregados ejemplos few-shot inline (5 casos: indecision, compra_directa, cierre_frio, cuota, comparacion)

gpt.ts (buildCarDealershipSystemPrompt):
- Agregadas intenciones adicionales (mismas que agent.ts)
- Agregados ejemplos few-shot inline (5 casos mismos)
- Reglas más específicas sobre cuándo derivar y qué no inventar

**Why:** El bot tenía cobertura insuficiente para los casos comerciales más frecuentes. Respondía de forma genérica o robótica en situaciones clave como cierre, comparación e indecisión.

**How to apply:** Cuando se detecten nuevos errores del bot, revisar si existe policy/playbook/FAQ que debería cubrirlo. Si no existe, crear una nueva migración SQL. Si el problema es de tono o few-shot, editar los prompts en agent.ts y gpt.ts.
