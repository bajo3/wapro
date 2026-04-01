# WaPro Brain

Este directorio centraliza la memoria incremental del proyecto. Es la fuente de verdad humana para contexto, decisiones, bugs, reglas del catálogo y regresiones.

## Archivos
- `project_state.md`: estado actual y focos activos
- `known_bugs.md`: bugs abiertos/cerrados importantes
- `catalog_rules.md`: reglas de normalización y lectura de catálogo
- `bot_sales_rules.md`: reglas comerciales del bot vendedor
- `deployment_notes.md`: notas de deploy, envs y diagnóstico
- `regression_cases.md`: casos de prueba que no deben romperse

## Uso
Actualizar este directorio en cada fix importante. Si cambia comportamiento del bot o del catálogo, registrar:
1. problema
2. causa raíz
3. fix aplicado
4. cómo validarlo
