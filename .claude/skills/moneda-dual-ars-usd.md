---
name: moneda-dual-ars-usd
description: Manejar precios en contexto de doble moneda ARS/USD en el mercado automotriz argentino sin inventar valores ni confundir al lead.
version: 1.0
owner: wapro
---

# Skill: Moneda dual ARS/USD

## Contexto
El mercado automotriz argentino opera en doble moneda. Los 0km se publican en ARS, los usados frecuentemente en USD o en ARS-referenciado-a-dólar. La volatilidad cambiaria hace que los precios cambien rápidamente.

## Reglas base

- Nunca convertir entre monedas usando tipo de cambio propio — el bot no tiene acceso al dólar del día
- Nunca confirmar un precio en la moneda opuesta a la que figura en el sistema
- Siempre aclarar en qué moneda está el precio cuando se lo pase al lead
- Si el lead pregunta cuánto es "en pesos" un precio en USD (o viceversa), explicar que depende del tipo de cambio del día y derivar

## Situaciones frecuentes

### El precio del sistema está en USD y el lead pregunta en ARS

**No hacer:**
- Convertir usando dólar oficial, blue o cualquier referencia propia
- Dar una cifra aproximada "a modo orientativo"

**Hacer:**
- Informar el precio en USD tal como está
- Aclarar que la conversión depende del tipo de cambio vigente
- Derivar a vendedor si el lead necesita el número en pesos

**Ejemplo:**
"El precio está publicado en USD. Para darte el equivalente en pesos te conviene hablar directamente con el equipo — el tipo de cambio varía y no quiero darte un número desactualizado."

---

### El precio del sistema está en ARS pero parece referenciado a dólar

**Señales:** El precio es un número "redondo" en miles o millones que cambia frecuentemente.

**Hacer:**
- Pasar el precio en ARS tal como figura
- Aclarar que puede actualizarse según el mercado
- No especular sobre si está "en dólar" o no

---

### El lead mezcla monedas en su consulta

**Ejemplo:** "Tengo 10 palos y algo en verde, ¿me alcanza para un Corolla?"

**Hacer:**
- Registrar ambos datos por separado en el perfil del lead
- No intentar sumar o convertir
- Pedir aclaración simple: "¿Los pesos y los dólares son para el total, o uno es para el anticipo y el otro para cuotas?"

---

### El lead tiene permuta en USD y quiere comprarse algo en ARS

**Hacer:**
- Registrar que hay permuta y que el lead opera en doble moneda
- Derivar a vendedor con ambos datos claros
- No calcular diferencial entre monedas

---

## Formato de registro en el lead

```json
{
  "presupuesto_ars": null,
  "presupuesto_usd": null,
  "moneda_preferida": "ARS | USD | mixta | no_especificada",
  "tiene_permuta": true,
  "nota_moneda": "El lead tiene presupuesto mixto: X ARS + Y USD"
}
```

## Falla si
- Convierte monedas con tipo de cambio propio
- Suma ARS y USD como si fueran equivalentes
- Omite aclarar en qué moneda está el precio
- Confirma un precio sin especificar la moneda
