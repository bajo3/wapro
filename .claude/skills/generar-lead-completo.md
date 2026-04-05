---
name: generar-lead-completo
description: Convertir conversaciones comerciales en leads estructurados, accionables y útiles para el CRM.
version: 1.0
owner: wapro
---

# Skill: Generar lead completo

## Objetivo
Transformar una conversación en un lead claro, útil y accionable para vendedores, CRM y seguimiento.

## Cuándo generar lead
Generar o actualizar lead cuando haya alguna de estas señales:
- consulta concreta por vehículo
- interés comercial claro
- presupuesto
- financiación
- permuta
- pedido de visita
- solicitud de contacto
- continuidad de conversación

## Campos mínimos del lead
- nombre
- telefono
- origen
- interes_principal
- marca_interes
- modelo_interes
- presupuesto
- moneda
- financiacion
- permuta
- urgencia
- etapa
- siguiente_accion
- resumen
- confianza_datos

## Etapas permitidas
- nuevo
- consultando
- interesado
- caliente
- listo_para_visita
- derivar_vendedor
- perdido
- sin_datos_suficientes

## Reglas
- Completar solo con lo que exista.
- No inventar datos personales.
- No inventar presupuesto si no fue dicho.
- Si no hay nombre, dejar null.
- Si no hay teléfono, dejar null.
- El resumen debe ser corto y útil.
- La siguiente acción debe ser concreta.

## Criterios para etapa

### nuevo
Primer contacto con poco contexto.

### consultando
Preguntas generales o exploración.

### interesado
Interés claro por vehículo o compra.

### caliente
Intención fuerte, alta urgencia o señales de cierre.

### listo_para_visita
Quiere coordinar o ver la unidad.

### derivar_vendedor
Pide contacto humano o caso sensible.

### perdido
Desinterés o imposibilidad clara.

### sin_datos_suficientes
No alcanza para trabajar bien el caso.

## Criterios para urgencia
- alta: quiere resolver pronto, visitar hoy, cerrar, reservar
- media: interés real pero no inmediato
- baja: exploratorio, sin señales de timing

## Formato ideal
```json
{
  "nombre": null,
  "telefono": null,
  "origen": "whatsapp",
  "interes_principal": "consulta por Toyota Corolla automático",
  "marca_interes": "Toyota",
  "modelo_interes": "Corolla",
  "presupuesto": 22000000,
  "moneda": "ARS",
  "financiacion": true,
  "permuta": false,
  "urgencia": "media",
  "etapa": "interesado",
  "siguiente_accion": "ofrecer opciones confirmadas y avanzar a visita o contacto vendedor",
  "resumen": "Cliente busca Toyota Corolla automático, desde 2018, con presupuesto hasta 22 millones y posibilidad de financiación.",
  "confianza_datos": "alta"
}