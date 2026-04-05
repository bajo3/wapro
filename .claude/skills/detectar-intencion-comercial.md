---
name: detectar-intencion-comercial
description: Identificar la intención principal y secundaria del cliente en conversaciones comerciales automotrices.
version: 1.0
owner: wapro
---

# Skill: Detectar intención comercial

## Objetivo
Determinar qué quiere lograr el cliente en este turno de conversación para elegir la mejor respuesta y siguiente acción.

## Esta skill debe usarse siempre
Toda interacción comercial debe pasar por detección de intención antes de responder.

## Intenciones principales permitidas
- saludo
- consulta_stock
- consulta_precio
- consulta_financiacion
- consulta_permuta
- recomendacion
- comparacion
- agendar_visita
- cierre_operacion
- seguimiento
- reclamo
- derivar_humano
- fuera_de_alcance

## Intenciones secundarias posibles
- urgencia_alta
- busca_bajo_consumo
- busca_familiar
- busca_trabajo
- busca_automatico
- busca_pocos_km
- busca_barato
- busca_marca_especifica
- tiene_presupuesto
- requiere_financiacion
- tiene_permuta

## Reglas
- Elegir una sola intención principal.
- Se pueden agregar varias secundarias.
- Si la frase es ambigua, inferir con prudencia.
- No sobreinterpretar.
- Si la confianza es baja, marcarlo.

## Señales por intención

### saludo
Ejemplos:
- hola
- buen día
- cómo va
- hay alguien

### consulta_stock
Ejemplos:
- tenés
- hay
- te quedó
- entró
- disponible

### consulta_precio
Ejemplos:
- cuánto vale
- precio
- cuánto sale
- valor

### consulta_financiacion
Ejemplos:
- financiás
- cuotas
- anticipo
- entrega y cuotas
- tna
- tasa

### consulta_permuta
Ejemplos:
- tomás usado
- permuta
- entrego mi auto
- parte de pago

### recomendacion
Ejemplos:
- qué me recomendás
- busco algo
- no sé cuál comprar
- quiero algo confiable

### comparacion
Ejemplos:
- cuál conviene más
- comparame
- corolla o cruze
- qué diferencia hay

### agendar_visita
Ejemplos:
- puedo verlo
- paso hoy
- coordinar visita
- ir a la agencia

### cierre_operacion
Ejemplos:
- quiero reservar
- cómo hago para señarlo
- lo compro
- lo cierro

### seguimiento
Ejemplos:
- qué pasó con
- me habías dicho
- seguimos
- quedó algo

### reclamo
Ejemplos:
- me clavaron
- no me respondieron
- esto está mal
- me pasaron mal el precio

### derivar_humano
Ejemplos:
- pasame con alguien
- quiero hablar con vendedor
- llamame

## Formato de salida ideal
```json
{
  "intent": "consulta_financiacion",
  "confidence": "alta",
  "secondary_intents": ["consulta_precio", "urgencia_alta"],
  "reason": "El cliente consulta por cuotas y anticipo con intención comercial clara."
}