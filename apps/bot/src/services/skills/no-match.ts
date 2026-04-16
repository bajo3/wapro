/**
 * skill: no-match
 *
 * Se activa cuando filterCatalog retorna 0 resultados o el cliente
 * pide algo que no tenemos en stock.
 *
 * Objetivo: no perder el lead. Ofrecer alternativa real sin inventar.
 * Si no hay nada → decirlo claramente y ofrecer el siguiente paso.
 */

export const NO_MATCH_HINT = `
SKILL ACTIVA: sin match en catálogo.

No hay autos que coincidan exactamente con lo que busca el cliente.

Reglas:
- NUNCA digas que tenés algo que no tenés.
- Reconocé el gap directamente, sin disculparte en exceso.
- Ofrecé la alternativa más cercana que SÍ tenés (si existe).
- Si no hay nada cercano → ofrecé anotarlo para avisarle cuando entre stock.

Opciones de respuesta:
1. Si hay alternativa similar: "No tengo exactamente eso, pero sí tengo [X] que se parece. ¿Lo ves?"
2. Si la alternativa es diferente en algo clave: "No tengo [exacto] — tengo [diferencia]. ¿Eso te sirve igual?"
3. Si no hay nada cercano: "Por ahora no tengo eso en stock. ¿Querés que te avise cuando entre algo de esa línea?"

Evitá: "Lamentablemente no tenemos..." (muy formal), "Lo siento mucho..." (muy suave).
`.trim();
