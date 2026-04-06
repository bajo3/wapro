---
name: seguimiento-lead-frio
description: Estrategia de re-engagement para leads que no respondieron o quedaron fríos después de la consulta inicial.
version: 1.0
owner: wapro
---

# Skill: Seguimiento de lead frío

## Objetivo
Recuperar leads que perdieron contacto sin ser invasivo. El seguimiento mal hecho aleja; el bien hecho reactiva.

## Definición de lead frío
Un lead es frío cuando:
- No respondió en las últimas 24 horas tras una conversación activa
- Respondió "lo pienso" y no volvió en 48 horas
- Quedó en etapa "interesado" o "consultando" sin movimiento en 72+ horas

## Ventanas de seguimiento recomendadas

| Tiempo sin respuesta | Acción sugerida | Tono |
|---|---|---|
| 24 hs | Recordatorio suave | Amigable, sin presión |
| 48 hs | Aporte de valor (novedad, alternativa) | Consultivo |
| 7 días | Último intento + cierre limpio | Directo y breve |
| +7 días | Derivar a campaña de re-engagement o archivar | — |

## Mensajes por ventana

### 24 horas — recordatorio suave
"Hola [nombre si disponible], quedé pendiente de tu consulta sobre [vehículo o categoría]. ¿Pudiste pensar o tenés alguna duda que te pueda resolver?"

### 48 horas — aporte de valor
Opciones:
- Nueva unidad que encaja con su búsqueda: "Entró algo que puede interesarte según lo que me contaste — [descripción breve sin inventar stock]. ¿Querés que te paso el detalle?"
- Recordatorio de financiación si lo había mencionado: "¿Pudiste ver el tema de la financiación? Puedo coordinar una consulta rápida con el equipo si querés."
- Pregunta simple: "¿Seguís buscando o ya lo resolviste?"

### 7 días — cierre limpio
"Hola, te escribo por última vez por tu consulta de [vehículo/categoría]. Si seguís interesado, estoy disponible. Si ya lo resolviste, genial — cualquier cosa que necesites en el futuro, acá estamos."

## Reglas

- Máximo 3 mensajes de seguimiento por lead en 7 días
- Nunca enviar dos mensajes el mismo día
- Si el lead responde "no gracias" o similar, marcar como perdido y no reintentar
- No mencionar precio ni condiciones en el seguimiento sin que el lead lo pida — genera ruido
- Si el lead reactiva, retomar desde donde quedó: usar el contexto registrado, no empezar de cero
- Personalizar con datos reales del lead si están disponibles (vehículo consultado, presupuesto, condición)

## Señales de reactivación

Considerar el lead reactivado si:
- Responde cualquier cosa al mensaje de seguimiento
- Vuelve a preguntar por stock o precio
- Menciona que sigue buscando

Acción ante reactivación: actualizar etapa a "consultando" o "interesado" y retomar flujo normal.

## Señales de cierre definitivo

Marcar como perdido si:
- Responde "ya lo resolví", "compré en otro lado", "no gracias"
- No responde al mensaje de 7 días
- Bloquea el número

## Registro esperado en el lead

```json
{
  "ultimo_contacto": "2026-04-05T14:00:00Z",
  "intentos_seguimiento": 1,
  "estado_seguimiento": "pendiente | en_curso | reactivado | cerrado",
  "motivo_cierre": null
}
```

## Falla si
- Envía más de 3 mensajes en 7 días
- Repite la misma pregunta que ya fue ignorada
- Empieza el seguimiento sin revisar el contexto previo del lead
- No registra el intento de seguimiento en el perfil
