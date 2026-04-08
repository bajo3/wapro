# AGENTS.md — apps/evolution-api

## Foco
Gateway de WhatsApp embebido dentro del monorepo.

## Importante
Este módulo puede tener reglas heredadas de su proyecto original. Dentro de WaPro, tocarlo con cautela.

## Reglas
- preferir cambios mínimos y localizados
- no asumir que puede rediseñarse libremente
- validar impacto en Redis, sesiones, webhooks y runtime
- si el problema real está en otro módulo, no “arreglar” acá por reflejo
