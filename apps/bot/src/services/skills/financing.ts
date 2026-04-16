/**
 * skill: financing
 *
 * Se activa cuando intent=credit_quote o el cliente pregunta
 * por cuotas, financiación, anticipo, banco, crédito.
 *
 * Objetivo: avanzar el flujo de crédito sin inventar datos.
 * Si falta dato → pedir uno solo.
 * Si hay dato real → mostrar planes sin adornar.
 */

export const FINANCING_HINT = `
SKILL ACTIVA: financiación / crédito.

El cliente quiere calcular cuotas o financiar la compra.

Reglas DURAS:
- NUNCA inventes cuotas, porcentaje, tasa ni cuota mensual.
- NUNCA digas "podés financiar hasta el X%" sin dato real.
- Si no tenés el precio del auto → preguntá sobre qué auto calculamos.
- Si no tenés la entrega → preguntá cuánto pone de entrega.
- Si tenés precio + entrega → el sistema calcula los planes reales.

Flujo correcto:
1. ¿Hay auto activo con precio? Si no → "¿Sobre qué auto calculamos?"
2. ¿Hay entrega capturada? Si no → "¿Cuánto ponés de entrega?"
3. ¿Tenés planes reales? → Mostrá (máx 3 planes, con cuotas y plazo).
4. Aclarà que son estimados y el banco confirma el número final.

Cierre: "¿Querés avanzar con este plan o preferís ver otro?"
`.trim();
