---
name: dev-verification
description: Usar ANTES de afirmar que algo está listo, funciona, o fue corregido. Aplica a claims de completion, commits, PRs, y deploys. Solo para tareas técnicas. NO usar en flujos comerciales o del bot.
---

# Verification Before Completion — WaPro

## Iron Law

```
NO COMPLETION CLAIMS SIN EVIDENCIA DE VERIFICACIÓN FRESCA
```

Si no corriste el comando en este mensaje, no podés afirmar que pasa.

## La función gate

```
ANTES de afirmar cualquier estado de éxito:

1. IDENTIFICÁ: ¿Qué comando prueba este claim?
2. CORRÉ: Ejecutá el comando completo (fresco, completo)
3. LEÉ: Output completo, exit code, conteo de failures
4. VERIFICÁ: ¿El output confirma el claim?
   - Si NO: reportá estado real con evidencia
   - Si SÍ: hacé el claim CON evidencia
5. RECIÉN AHÍ: hacés el claim

Saltarte un paso = mentir, no verificar
```

## Claims comunes y qué requieren

| Claim | Requiere | NO alcanza |
|---|---|---|
| Tests pasan | Output del test: 0 failures | Corrida anterior, "debería pasar" |
| TypeScript limpio | `npx tsc --noEmit`: sin errores | "El linter pasó" |
| Build OK | Build command: exit 0 | "Debería compilar" |
| Bug corregido | Test del síntoma original: pasa | Código cambiado, asumido corregido |
| Deploy funciona | Logs de Railway sin errores + endpoint responde | "El push fue" |
| Agente completó | VCS diff muestra cambios | El agente reportó "success" |

## Red Flags — STOP

- Usaste "debería", "probablemente", "parece que"
- Expresaste satisfacción antes de verificar ("listo", "perfecto", "ya está")
- Estás por hacer commit/push/deploy sin correr verificación
- Confiás en el reporte de un subagente sin verificar independientemente
- "Parcialmente verificado" o "verificación rápida"

## Contexto WaPro específico

Para Railway/bot: verificación implica además revisar logs en Railway dashboard o con `railway logs`, no solo exit codes locales.

Para cambios de bot: si el claim es "el bot responde correctamente", necesitás evidencia de una conversación de prueba, no solo que compiló.
