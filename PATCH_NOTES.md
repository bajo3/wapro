# wapro - hotfix backend deploy

## Qué corrige
- **apps/panel-whaticket/backend**: agrega la dependencia faltante **axios** para que compile (tsc) y el build de Railway no falle.

## Commit sugerido
`fix(panel-backend): add axios dependency`

## Deploy
- Railway va a poder correr `npm run build` sin el error: `Cannot find module 'axios'`.

