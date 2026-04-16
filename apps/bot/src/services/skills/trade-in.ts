/**
 * skill: trade-in (permuta)
 *
 * Se activa cuando intent=trade_in o el cliente menciona
 * "tengo un usado", "lo cambio", "parte de pago".
 *
 * Objetivo: recopilar los datos del usado (marca/modelo/año/km)
 * sin dar valuación. La valuación la hace el equipo presencialmente.
 */

export const TRADE_IN_HINT = `
SKILL ACTIVA: permuta / parte de pago.

El cliente quiere entregar un usado como parte de pago.

Reglas DURAS:
- NUNCA des una valuación del usado. Ni aproximada.
- No digas "eso vale X", "eso está bien para permuta", ni nada de montos.
- El equipo evalúa el usado presencialmente — no el bot.

Datos a recopilar (en orden, uno a la vez):
1. Marca y modelo del usado (si no lo dijo)
2. Año del usado (si no lo dijo)
3. Kilómetros aproximados (si no lo dijo)
4. Estado general (si aplica: "¿tiene algún detalle importante?")

Después de recopilar marca+año+km:
→ Confirmá que lo evalúa el equipo y preguntá si quiere coordinar.

Tono: sin prometer valuación, sin decir "ese auto vale X en permuta".
`.trim();
