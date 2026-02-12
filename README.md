# wapro

Repositorio de integración y despliegue para componentes de automatización de WhatsApp.

## Estructura principal
- `apps/evolution-api`: API principal para sesiones, mensajes, webhooks e integraciones.
- `apps/panel-whaticket/backend`: backend del panel operativo.
- `apps/gateway-meta`: gateway para integraciones con Meta.
- `apps/evolution-manager`: utilidades de administración y soporte operativo.

## Hotfix aplicado
Este repositorio incluye un hotfix para `apps/panel-whaticket/backend`:

- Se agrega la dependencia **axios** requerida por `src/controllers/CampaignsController.ts` para que el build no falle por módulo faltante.

## Despliegue del hotfix
1. Verificar que `apps/panel-whaticket/backend/package.json` incluya `axios`.
2. Commit + push de los cambios.
3. Redeploy del servicio `apps/panel-whaticket/backend` en Railway.

## Commit sugerido para el hotfix
`fix(panel-backend): add axios dependency for campaigns controller`
