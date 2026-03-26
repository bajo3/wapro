---
name: Estilo de auditoría de backend esperado
description: Cómo el usuario espera que se hagan las auditorías de backend en WaPro
type: feedback
---

El usuario pide auditorías completas que lean todos los archivos involucrados antes de tocar nada,
identifiquen causa raíz (no síntomas), y apliquen el fix más corto que cierre el problema completo.

**Why:** En WaPro los bugs suelen ser silenciosos (200 OK pero no persiste, stub que devuelve null, etc.).
Cambiar código sin leer el contexto completo genera regresiones.

**How to apply:**
1. Leer todos los archivos relevantes en paralelo antes de escribir cualquier fix.
2. Separar bugs críticos (rompen funcionalidad core) de mejoras (diagnóstico, validaciones extra).
3. Aplicar el fix mínimo que resuelve el problema real. No agregar features no pedidas.
4. Verificar contratos: si se cambia un campo, buscar todos los consumers (frontend + bot + gateway).
5. Devolver resumen con: causa raíz, archivos afectados, fix aplicado, riesgos de regresión, checklist de validación.
