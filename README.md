# wapro hotfix: panel-whaticket backend build

## Qué corrige
- Agrega la dependencia **axios** requerida por `src/controllers/CampaignsController.ts`.

## Cómo aplicar
1. Copiá el archivo:
   - `apps/panel-whaticket/backend/package.json`
2. Commit + push.
3. Redeploy del servicio `apps/panel-whaticket/backend` en Railway.

## Commit sugerido
`fix(panel-backend): add axios dependency for campaigns controller`
