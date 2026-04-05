---
name: extraer-filtros-del-cliente
description: Extraer filtros comerciales útiles desde mensajes de leads automotrices.
version: 1.0
owner: wapro
---

# Skill: Extraer filtros del cliente

## Objetivo
Pasar de texto libre a estructura útil para búsqueda, ranking, lead y siguiente acción.

## Campos esperados
- marca
- modelo
- version
- año_exacto / año_desde / año_hasta
- presupuesto
- moneda
- financiación
- permuta
- transmisión
- combustible
- tipo_vehiculo
- km_max / pocos_km
- uso_principal
- urgencia
- observaciones

## Reglas
- no inventar valores ausentes
- preferir `null` antes que inferencia floja
- normalizar moneda, transmisión y combustible
- si el cliente da rango, conservarlo como rango

## Ejemplo
Cliente: "Busco SUV usada hasta 25 millones, automática y con pocos km"

Salida ideal:
```json
{
  "tipo_vehiculo": "suv",
  "presupuesto": 25000000,
  "moneda": "ARS",
  "transmision": "automatica",
  "km_texto": "pocos km",
  "condicion": "usado"
}
```
