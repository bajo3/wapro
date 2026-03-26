---
name: Variables de entorno del bot WaPro
description: Cuáles env vars son requeridas, cuáles son opcionales, y cuáles bypasean env.ts via process.env directo
type: project
---

## Requeridas (validadas por zod en env.ts — fallan en startup si faltan)
- `BOT_WEBHOOK_SECRET` (min 6)
- `BOT_ADMIN_TOKEN` (min 6)
- `EVOLUTION_API_URL` (url)
- `EVOLUTION_API_KEY` (min 8)
- `EVOLUTION_INSTANCE` (min 1)
- `DATABASE_URL` (min 1)

## Opcionales con default (en env.ts)
- `OPENAI_API_KEY` — activa GPT fallback, sin ella el bot responde con mensajes estáticos
- `OPENAI_MODEL` — modelo base (default: `gpt-4o-mini`)
- `DEALERSHIP_NAME` — nombre de la agencia en el prompt GPT

## Opcionales usadas via process.env directo (NO registradas en env.ts)
- `OPENAI_MODEL_ADVANCED` — modelo avanzado para etapa de cierre (leadScore >= 60). Usado en `agent.ts:selectModel()`. Si no se setea, cae en `OPENAI_MODEL` como fallback (comportamiento seguro). No rompe el build ni el arranque.
- `RECONTACT_MAX_DEFAULT` — valor por defecto para recontactMax en demands (default: 3 hardcodeado con fallback a 5)

## Notas
- `OPENAI_MODEL_ADVANCED` no es requerida. Su ausencia es segura (fallback a base model).
- Si se quiere activar el modelo avanzado en Railway, agregar como var de entorno opcional.

**Why:** En una sesión de auditoría se detectó que OPENAI_MODEL_ADVANCED se consume con process.env directo sin pasar por env.ts, lo que significa que no está validada en startup pero tampoco es bloqueante.
**How to apply:** Al revisar Railway env vars, recordar que OPENAI_MODEL_ADVANCED es opcional y su ausencia no rompe nada.
