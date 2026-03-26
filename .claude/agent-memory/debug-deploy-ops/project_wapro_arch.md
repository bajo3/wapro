---
name: WaPro arquitectura general
description: Estructura de servicios del monorepo WaPro y cómo se despliegan en Railway
type: project
---

WaPro es un monorepo Node.js/TypeScript con los siguientes servicios:

- `apps/bot` — Bot de WhatsApp (ESM, `"type":"module"`, tsc → dist/). Corre en Railway con `node dist/index.js`.
- `apps/panel-whaticket/backend` — Backend del panel (CommonJS, Sequelize, decoradores).
- `apps/panel-whaticket/frontend` — Frontend React.
- `apps/evolution-api` — Adaptador para Evolution API.

**Build del bot:**
- prebuild: `check:conflicts` (detecta markers de merge)
- build: `tsc -p tsconfig.json`
- start: `node --enable-source-maps dist/index.js`
- moduleResolution: `Bundler` — los imports deben incluir extensión `.js`

**Deploy:**
- No hay `railway.toml` en la raíz. Solo hay un `railway.json` dentro de `apps/evolution-api`.
- Docker Compose dev disponible en `docker-compose.dev.yml`.

**Why:** Conocer la estructura evita proponer cambios de infraestructura cuando el bug es de config.
**How to apply:** Cuando analices fallos de build o deploy, verificar primero si el módulo es ESM o CJS, y si los imports usan `.js`.
