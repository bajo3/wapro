---
name: railway-deploy-sanity-check
description: Validación mínima para cambios que pueden afectar Railway: build, start, runtime, env vars, healthcheck y CORS.
---

## Secuencia
1. revisar comandos de build/start
2. revisar env vars críticas
3. revisar puertos/healthchecks
4. revisar dependencias externas
5. definir validación post-deploy

## Regla
No declarar listo solo porque el build pasa.
