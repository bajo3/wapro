# Optimización aplicada a `.claude`

## Cambios estructurales
- eliminado `revenue-commander` por solapamiento con `bot-sales-brain`
- removido `settings.local.json` por ser local y no portable
- estandarizados los agentes con scope explícito
- agregado mapa de runtime real de WaPro
- completadas skills faltantes
- completadas evaluations mínimas

## Problemas que tenía el pack previo
- solapamiento entre agentes comerciales
- documentación todavía pensada como “pack elite” y no como repo real
- ausencia de skills clave para extraer filtros, vender consultivamente y escalar
- falta de pruebas sobre stock y visita/escalado
- presencia de config local específica de una máquina

## Estado final
La carpeta queda mejor preparada para:
- Claude Code
- Cowork como capa estratégica
- evolución incremental del bot real
