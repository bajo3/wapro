# CLAUDE.md

## Proyecto
WaPro es un monorepo orientado a CRM automotor para agencias.
Incluye panel, bot, gateway/meta y flujos de ventas para leads, tickets, cotizaciones, demandas y seguimiento comercial.

## Objetivo actual
Prioridad máxima:
1. Mejorar la inteligencia del bot para que actúe como vendedor más útil, natural y robusto.
2. Mejorar UI/UX del panel para que todo sea más intuitivo, consistente y prolijo.
3. Evitar regresiones en deploy/build y mantener compatibilidad con Railway.
4. Mejorar estabilidad general del sistema.

## Stack principal
- Monorepo JavaScript / TypeScript
- Frontend: React
- Backend: Node.js / Express
- ORM: Sequelize
- DB: PostgreSQL
- Deploy: Railway
- Control de versiones: GitHub

## Apps del monorepo
- apps/bot: lógica del bot y flujos conversacionales
- apps/panel-whaticket: frontend + backend del panel CRM
- apps/gateway-meta: integración con Meta / webhooks

## Reglas de trabajo
- No inventar variables de entorno nuevas si ya existe una equivalente.
- Si hace falta una env nueva, justificarla claramente.
- No romper compatibilidad con Railway.
- No tocar código de forma innecesaria fuera del alcance del fix.
- Mantener consistencia visual en todo el proyecto.
- Mantener compatibilidad entre frontend y backend.
- Priorizar fixes completos sobre parches superficiales.

## Prioridades funcionales actuales
### Bot
- Debe evitar repetir preguntas ya respondidas por el usuario.
- Debe detectar presupuesto, marca, modelo, permuta, financiación y contexto comercial.
- Debe sonar natural, vendedor y humano, sin parecer robot tonto.
- Debe orientar a cierre o siguiente paso útil.
- Debe manejar mejor objeciones y mensajes ambiguos.

### UI/UX
- El panel debe sentirse más limpio, coherente y fácil de usar.
- Evitar layouts incómodos o con scroll horizontal innecesario.
- Mejorar legibilidad, jerarquía visual y consistencia entre módulos.

### Backend/API
- Revisar especialmente problemas de normalización de campos (`imageUrl` vs `image_url`).
- Revisar persistencia correcta de datos en replies y tickets.
- Cuidar encoding UTF-8 para tildes, eñes y emojis.
- Mantener contratos API claros entre frontend y backend.

### Flujos críticos
Siempre validar, si fueron tocados:
- creación de cotizaciones
- búsqueda de clientes y vehículos
- tickets
- pipeline
- demandas
- respuestas del bot
- configuración del bot
- integraciones con WhatsApp/Meta

## Estándar de entrega
- Si se propone un fix, también revisar efectos colaterales.
- Siempre que sea posible, validar build o chequeos mínimos antes de dar por terminado.
- Entregar cambios de forma clara y ordenada.
- Si se genera un ZIP para entrega final, no incluir `.git`.
- Cuando corresponda, incluir nombre de commit sugerido.

## Estilo de implementación
- Hacer cambios concretos y mantenibles.
- Evitar sobrearquitectura innecesaria.
- Preferir soluciones simples, claras y robustas.
- Si hay varias opciones, elegir la más compatible con el estado actual del proyecto.

## Qué revisar especialmente en este repo
- errores de deploy/build
- CORS
- inconsistencias frontend/backend
- flujos de cotizaciones
- flujos de demandas
- tickets UI/UX
- bot intelligence
- compatibilidad con Railway
- variables de entorno
- logs útiles para diagnóstico

## Forma de razonar sobre cambios
Antes de cambiar algo:
1. Entender el flujo completo.
2. Detectar archivos impactados.
3. Buscar causa raíz, no solo síntoma.
4. Minimizar riesgo de regresión.
5. Validar que frontend, backend y deploy sigan coherentes.

## Si se trabaja sobre UI
- Mejorar claridad visual
- Reducir fricción de uso
- Mantener consistencia entre pantallas
- Evitar componentes recargados
- Evitar scroll horizontal si se puede resolver mejor

## Si se trabaja sobre bot
- Priorizar contexto conversacional
- No repetir preguntas
- Recordar lo ya dicho por el lead
- Guiar hacia acción comercial útil
- Sonar humano y vendedor
- Evitar respuestas genéricas o vacías