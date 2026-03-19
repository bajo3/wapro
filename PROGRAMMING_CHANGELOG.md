# Programming ChangeLog

## Propósito
Este archivo deja trazabilidad técnica permanente del proyecto para cada entrega con ZIP.
Se actualiza en **cada sprint / fix / refactor** para:

- registrar qué se cambió
- registrar qué quedó pendiente
- registrar migraciones necesarias
- registrar riesgos y errores evitados
- reducir reprocesos y evitar repetir errores ya resueltos

## Regla de trabajo permanente
A partir de esta etapa, toda entrega relacionada a programación debe incluir actualización de este archivo.

## Formato estándar por entrega
Cada entrada debe incluir:

- fecha
- sprint o nombre corto
- objetivo
- archivos tocados
- migraciones nuevas
- endpoints nuevos o modificados
- impacto funcional
- pendientes
- riesgos / cuidados de deploy
- errores evitados o lecciones aprendidas

---

## 2026-03-19 — Sprint 1 — Agente comercial estructurado

### Objetivo
Primer corte para transformar el bot actual en un agente comercial más consistente y visible para el vendedor.

### Cambios principales
- se agregó `apps/bot/src/services/agent.ts`
- se mejoró el fallback del bot para que use decisión estructurada en JSON
- se agregó `askGPTJson()` en `apps/bot/src/services/gpt.ts`
- se mejoró scoring comercial en `apps/bot/src/services/lead.ts`
- se agregó memoria comercial base en `apps/bot/src/services/leadProfile.ts`
- se integró persistencia de memoria comercial desde `apps/bot/src/routes/webhooks.ts`
- se expuso información del agente en ticket desde backend y frontend
- se agregó bloque visible del agente en `ImprovedTicketChat.jsx`

### SQL / migraciones
- `apps/bot/sql/009_agent_memory.sql`

### Impacto funcional
- el bot ahora puede devolver intención, acción sugerida, confianza, faltantes y recomendación de handoff
- el vendedor puede ver esa salida en el ticket
- el lead empieza a tener memoria comercial persistente base

### Pendientes al cierre
- feedback humano persistente
- bandeja de feedbacks
- exportación de feedback a ejemplos
- loop de entrenamiento real

### Riesgos / cuidados
- correr la SQL nueva antes del deploy del bot
- validar variables del bot (`BOT_URL`, `BOT_ADMIN_TOKEN`, `OPENAI_API_KEY` si corresponde)

### Errores evitados / lecciones
- no mezclar todavía ML pesado con poca data real
- priorizar arquitectura híbrida: reglas + LLM + memoria + feedback
- no hacer que el LLM responda directo sin contrato estructurado

---

## 2026-03-19 — Sprint 2 — Feedback persistente desde el panel

### Objetivo
Capturar evaluación real del vendedor sobre las sugerencias del agente.

### Cambios principales
- se creó modelo `AgentFeedback`
- se creó endpoint `POST /tickets/:ticketId/agent-feedback`
- se agregaron botones de feedback en `ImprovedTicketChat.jsx`
- se persiste veredicto del vendedor: `approved`, `rejected`, `edited`, `handoff`

### SQL / migraciones
- `apps/panel-whaticket/backend/src/database/migrations/20260319230000-create-agent-feedback.ts`

### Impacto funcional
- el sistema ya guarda qué sugerencias del agente fueron buenas o malas
- queda base real para entrenamiento posterior

### Pendientes al cierre
- listar feedbacks en panel Bot
- exportar feedback aprobado a examples
- dashboard de calidad del agente

### Riesgos / cuidados
- correr migración del panel backend antes del deploy

### Errores evitados / lecciones
- no mezclar feedback del vendedor con `TrainingMessage`
- separar evaluación humana de dataset manual para mantener trazabilidad limpia

---

## 2026-03-19 — Sprint 3 — Bandeja de feedback y exportación a ejemplos

### Objetivo
Hacer visible el feedback acumulado del agente y permitir convertirlo en ejemplos reutilizables.

### Cambios principales
- se agregó endpoint `GET /agent-feedbacks`
- se agregó endpoint `POST /agent-feedbacks/:feedbackId/export-example`
- se agregó bandera de exportación en `AgentFeedback`
- se agregó tab `Feedback` en `apps/panel-whaticket/frontend/src/pages/Bot/index.js`
- se pueden filtrar feedbacks por veredicto y estado de exportación
- se puede exportar un feedback a `examples` del bot desde el panel

### SQL / migraciones
- `apps/panel-whaticket/backend/src/database/migrations/20260319234000-add-export-flags-to-agent-feedback.ts`

### Impacto funcional
- el equipo puede auditar feedbacks reales del agente
- los casos útiles pueden convertirse en ejemplos de entrenamiento sin copiar/pegar manual

### Pendientes al cierre
- evitar exportaciones duplicadas más inteligentes por contenido
- vista de detalle del feedback con contexto de conversación
- métricas agregadas: aprobación, rechazo, handoff, top intents fallidos
- convertir feedback exportado en test cases sugeridos además de examples

### Riesgos / cuidados
- el endpoint de exportación depende de `BOT_URL` y `BOT_ADMIN_TOKEN`
- si el bot no está accesible, la exportación a example falla aunque el feedback siga guardado
- conviene exportar primero casos con `approved` o `edited` bien corregidos

### Errores evitados / lecciones
- no depender de memoria de chat para saber qué se implementó
- dejar historial técnico explícito para evitar repetir fixes o romper flujos ya resueltos
- marcar feedback exportado para no duplicar entrenamiento por descuido

---

## Próximos pasos sugeridos
1. vista detalle de feedback con contexto del ticket
2. métricas de calidad del agente en panel Bot
3. creación automática de test cases a partir de feedback aprobado
4. priorización de leads por score + urgencia + intención
5. mejor loop de entrenamiento con aprobación humana

---

## 2026-03-19 — Sprint 4 — Detalle de feedback, métricas y exportación a test cases

### Objetivo
Cerrar el tercer paso del loop operativo del agente: ver contexto real del ticket, medir calidad y convertir feedback útil en casos testeables.

### Cambios principales
- se agregó endpoint `GET /agent-feedbacks/stats`
- se agregó endpoint `GET /agent-feedbacks/:feedbackId`
- se agregó endpoint `POST /agent-feedbacks/:feedbackId/export-test-case`
- se enriqueció `GET /agent-feedbacks` con contacto, ticket y usuario
- se agregó exportación a test case en `AgentFeedback`
- se agregó dialog de detalle con últimos mensajes del ticket en la tab `Feedback`
- se agregaron métricas visibles del agente: total, aprobados, fallos, confianza promedio, exportados
- se agregaron rankings por intent: más fallidos y mejor resueltos

### SQL / migraciones
- `apps/panel-whaticket/backend/src/database/migrations/20260319235500-add-testcase-flags-to-agent-feedback.ts`

### Impacto funcional
- ya se puede revisar cada feedback con más contexto real antes de decidir si sirve para entrenamiento
- los casos buenos pueden ir no solo a `examples`, sino también a `test cases`
- el panel empieza a mostrar dónde falla más el agente y en qué intents funciona mejor

### Pendientes al cierre
- usar el feedback para sugerir correcciones automáticas
- métricas por vendedor / cola / canal
- deduplicación semántica antes de exportar a example o test
- tablero de leads priorizados por intención y urgencia

### Riesgos / cuidados
- correr la nueva migración antes del deploy del panel backend
- la exportación a test case también depende de `BOT_URL` y `BOT_ADMIN_TOKEN`
- el detalle usa últimos mensajes del ticket; si el ticket no tiene historial persistido, se verá vacío

### Errores evitados / lecciones
- no exportar a test case sin marca de persistencia porque eso genera duplicados difíciles de auditar
- no medir calidad solo con intuición; dejar métricas visibles evita entrenar a ciegas
- no revisar feedback aislado sin conversación asociada, porque lleva a entrenar ejemplos engañosos


## Hotfix — 2026-03-19 — Build bot TypeScript

### Problema
- Falló el deploy del servicio `apps/bot` en Railway por error TypeScript `TS5076` en `src/routes/webhooks.ts`.
- Se mezclaban operadores `||` y `??` en la misma expresión sin paréntesis.

### Fix aplicado
- Se reescribió la construcción de `faqSummary` para separar el cálculo de `faqTitle` y evitar la mezcla inválida de operadores.

### Archivo tocado
- `apps/bot/src/routes/webhooks.ts`

### Validación
- `cd apps/bot && npm run build` ✅

### Error evitado a futuro
- Cuando haya expresiones con fallback encadenado, separar en variables intermedias si aparece `??` junto con `||` o `&&`.
