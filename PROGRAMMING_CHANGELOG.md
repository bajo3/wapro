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

---

## 2026-03-19 — Sprint fix comercial — agente menos bot, cola inicial y handoff operativo

### Objetivo
Corregir cuatro puntos que seguían afectando ventas reales: mensajes del bot poco visibles en tickets, ranking flojo por presupuesto/marca, tono robótico y transición incompleta de cola a asesor.

### Cambios principales
- se reforzó la persistencia de mensajes salientes del bot hacia el panel con metadata adicional de operación:
  - `ticketStatus`
  - `botMode`
  - `handoff`
- cuando el bot detecta intención fuerte de cierre o derivación humana, ahora el ticket puede pasar automáticamente de `pending` a `open` y quedar en `HUMAN_ONLY`
- se endureció el filtrado comercial de vehículos:
  - si el cliente marca presupuesto, primero se muestran unidades dentro del rango
  - si no hay match real, recién ahí se muestran cercanas por arriba con aviso explícito
  - se prioriza más fuerte marca/modelo/transmisión/combustible/año
- se mejoró la detección de cierre:
  - reserva
  - seña
  - visita
  - “quiero ese”
  - “puedo ir”
  - “vamos con”
- se mejoró la detección de permuta/usado a entregar
- se humanizaron respuestas críticas:
  - saludo
  - búsqueda
  - precio
  - permuta
  - handoff
- en el panel, los mensajes del bot se distinguen con badge `Bot` cuando vienen persistidos con id sintético `bot-*`
- cuando el operador manda mensaje o toma ticket pendiente, el ticket pasa a `open`

### Archivos tocados
- `apps/bot/src/routes/webhooks.ts`
- `apps/bot/src/services/panelPersistence.ts`
- `apps/bot/src/services/agent.ts`
- `apps/bot/src/services/gpt.ts`
- `apps/bot/src/services/extract.ts`
- `apps/panel-whaticket/backend/src/controllers/EvolutionWebhookController.ts`
- `apps/panel-whaticket/backend/src/controllers/MessageController.ts`
- `apps/panel-whaticket/backend/src/services/TicketServices/UpdateTicketService.ts`
- `apps/panel-whaticket/frontend/src/components/MessagesList/index.js`

### Impacto funcional esperado
- los chats nuevos siguen en cola mientras responde el agente
- cuando el bot detecta intención de cierre y deriva a humano, el ticket ya no debería quedar visualmente “en cola”
- el vendedor debería ver con más claridad qué contestó el bot y distinguirlo del humano
- el bot debería respetar mejor presupuestos como “hasta 15 millones”
- el bot debería responder de forma más natural y menos robótica
- la permuta y la intención de seña/reserva deberían empujar más fuerte a derivación humana

### Validación realizada
- `cd apps/bot && tsc -p tsconfig.json --noEmit` ✅

### Riesgos / cuidados
- para ver persistencia completa del bot en tickets sigue siendo obligatorio tener bien configurados `BACKEND_URL` y `BOT_ADMIN_TOKEN`
- el badge `Bot` en el panel depende de que los mensajes persistidos mantengan el prefijo sintético `bot-`
- el backend del panel no quedó compilado de punta a punta en este entorno porque arrastra tests/deps externas fuera del alcance del fix

### Errores evitados / lecciones
- no mezclar ranking semántico con presupuesto sin una regla dura, porque termina recomendando unidades fuera del rango sin avisar
- no delegar a humano sin mover el ticket de estado, porque operativamente parece seguir “en cola”
- no dejar mensajes del bot indistinguibles del humano si el objetivo es auditar y mejorar al agente

## 2026-03-20 — Sprint 6 — Agente más vendedor y menos bot

### Objetivo
Mejorar el oficio comercial del agente: respuestas más naturales, una sola pregunta útil por vez, mejor lectura de cierre/visita/seña/financiación/permuta y resultados más curados.

### Cambios principales
- se reforzó el prompt estructurado del agente en `apps/bot/src/services/agent.ts`
- se reforzó el prompt del fallback GPT clásico en `apps/bot/src/services/gpt.ts`
- se redujo el listado por defecto de vehículos a 2-3 opciones mejor elegidas
- se mejoró `buildVehicleReply()` para sonar más asesor comercial y explicar mejor alternativas cercanas
- se agregaron helpers para hacer una sola pregunta útil por vez:
  - `getNextUsefulSearchQuestion()`
  - `getNextTradeInQuestion()`
  - `getNextFinanceQuestion()`
- se mejoró el fallback de búsqueda sin match claro para pedir un solo dato útil
- se mejoró el branch de permuta para no pedir todo junto
- se mejoró el branch de financiación para pedir un solo dato faltante por turno
- se afinó el scoring comercial para utilitarios, SUV, pickup y autos chicos
- se fortaleció la inferencia de utilitarios (`partner`, `berlingo`, `kangoo`, `vito`, `sprinter`, etc.)
- se endureció el tono comercial de respuestas de selección rápida y fallback

### SQL / migraciones
- no hay migraciones nuevas

### Impacto funcional
- el bot debería sonar menos robótico y más asesor
- ante búsquedas generales debería preguntar una sola cosa útil
- ante presupuesto debería priorizar menos cantidad y más calidad de opciones
- cuando no haya match exacto debería ofrecer alternativas cercanas con mejor justificación
- permuta y financiación deberían avanzar más ordenadas y sin pedir demasiadas cosas juntas

### Validación
- `tsc -p apps/bot/tsconfig.json --noEmit` ✅

### Pendientes al cierre
- tablero de leads priorizados en panel
- follow-up automático comercial
- métricas por vendedor/canal
- deduplicación inteligente antes de exportar examples/tests

### Riesgos / cuidados
- validar con conversaciones reales que el handoff por permuta no quede demasiado agresivo para ciertos casos
- seguir revisando el ranking de alternativas cuando no hay match exacto por modelo

### Errores evitados / lecciones
- no derivar automáticamente por cualquier mención de financiación
- evitar listas largas porque empeoran percepción y conversión
- pedir una sola cosa útil por vez mejora mucho la sensación de conversación humana

- 2026-03-31: Fix definitivo de stock del bot leyendo Supabase directo. Se eliminó el fallback silencioso a Railway para catálogo/demands cuando SUPABASE_DATABASE_URL está configurada, se quitó la dependencia del filtro incremental por `since` en demands y se agregó `/admin/catalog-debug`.

## 2026-04-01 — Frontend fix + Brain incremental
- Fix de build frontend: símbolo duplicado `MetricCard` en `apps/panel-whaticket/frontend/src/pages/Bot/index.js`.
- Se renombró el componente duplicado a `TestLabMetricCard`.
- Se creó `docs/brain/` como memoria incremental profesional del proyecto.
