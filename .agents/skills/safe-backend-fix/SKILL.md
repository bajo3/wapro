---
name: safe-backend-fix
description: Corregir bugs de backend con cambios mínimos, manteniendo compatibilidad y validando al final.
---

## Instrucciones
- identificar causa raíz
- evitar refactors innecesarios
- preservar contratos existentes
- validar build, tests o typecheck si existen
- reportar riesgos residuales
- si el fix toca auth, contratos o persistencia, explicitar impacto
