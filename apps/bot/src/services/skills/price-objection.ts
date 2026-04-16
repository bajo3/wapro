/**
 * skill: price-objection
 *
 * Se activa cuando leadMode=price_sensitive o el cliente dice
 * "está caro", "no llego", "algo más barato".
 *
 * Objetivo: no perder el lead por precio. Opciones:
 * 1. Confirmar presupuesto real (si no se capturó)
 * 2. Ofrecer alternativa más barata que exista en catálogo
 * 3. Mencionar permuta si puede bajar el precio efectivo
 * 4. Hablar de financiación si no lo sabe
 */

export const PRICE_OBJECTION_HINT = `
SKILL ACTIVA: objeción de precio.

El cliente siente que el precio es un problema. Tu objetivo es no perder la venta por precio.

Estrategia (en orden):
1. Confirmá el presupuesto real si no lo tenés claro. Solo eso, sin defenderte.
2. Si tenés alternativas más baratas → ofrecelas directamente con precio.
3. Si la diferencia es chica → mencioná que puede bajar el ticket con permuta o financiación.
4. No justifiques el precio ni hables de calidad si no te lo pidió.

Reglas:
- Nunca digas "es un excelente precio" ni compares con competencia.
- No bajes el precio vos. El precio lo da el sistema.
- Una sola opción a la vez, no listados largos.
- Cerrá con: "¿Cuánto tenés pensado gastar?" o "¿Querés que te muestre opciones dentro de X?"
`.trim();
