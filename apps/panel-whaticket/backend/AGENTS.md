# AGENTS.md — apps/panel-whaticket/backend

## Foco
API, persistencia, contratos, tickets, vehículos, cotizaciones, sockets e integración con bot.

## Reglas
- no romper contratos existentes
- no confundir 200 con persistencia correcta
- validar side effects reales: DB, sockets, respuesta HTTP
- si toca auth o webhooks, explicitar impacto
- si toca vehículos, revisar verdad comercial y source real
