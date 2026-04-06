---
name: escalar-a-humano
description: Detectar cuándo el bot debe derivar a una persona, cómo hacerlo y qué información pasar para proteger la venta.
version: 2.0
owner: wapro
---

# Skill: Escalar a humano

## Cuándo escalar — señales claras

### Escalar siempre (sin dudar)
- El lead pide explícitamente hablar con alguien: "pasame con alguien", "quiero hablar con un vendedor", "llamame"
- Quiere reservar, señar o cerrar la operación
- Pide visita inmediata o coordinar una visita hoy
- Hay reclamo, enojo o experiencia negativa
- Hay un dato crítico que el bot no puede confirmar y el riesgo de inventar es alto

### Escalar si persiste (después de 2 turnos sin resolución)
- Objeción de precio no resuelta
- Consulta de financiación compleja (múltiples variables, doble moneda, permuta + cuotas)
- Comparación detallada con competencia que requiere criterio comercial
- Ambigüedad sensible repetida sobre stock o disponibilidad

### No escalar
- Consultas simples que el bot puede resolver con información confirmada
- Leads exploratorios sin señal de compra inminente
- Preguntas generales sobre el proceso de compra

---

## Cómo hacer el escalado

### Mensaje al lead
Opciones según contexto:

**Cuando el lead lo pide:**
"Perfecto, te conecto con el equipo ahora. En un momento te contactan."

**Cuando hay intención de cierre:**
"Para avanzar con [reserva / visita / condiciones finales], lo mejor es que te hable directamente alguien del equipo. Te paso con ellos ahora."

**Cuando el bot no puede resolver:**
"Este punto lo maneja mejor alguien del equipo directamente. Te los conecto para que te den una respuesta precisa."

### Reglas del mensaje al lead
- No cortar la conversación abruptamente — siempre avisar que el escalado está en curso
- No pedir al lead que "espere" sin decirle cuánto o qué sigue
- No repetir información que ya se dio — el lead ya la sabe

---

## Qué información pasar al ticket / humano

El escalado debe incluir, como mínimo, el siguiente contexto estructurado:

```
ESCALADO BOT → HUMANO
─────────────────────
Lead: [nombre si disponible] | [teléfono]
Origen: WhatsApp
Etapa actual: [interesado / caliente / listo_para_visita / reclamo]
Urgencia: [alta / media / baja]

Interés principal: [vehículo o categoría]
Marca/modelo/año: [si fue especificado]
Presupuesto: [si fue mencionado, con moneda]
Financiación: [sí / no / consultó]
Permuta: [sí / no / consultó]

Motivo del escalado: [qué desencadenó la derivación]
Duda o bloqueo pendiente: [qué no pudo resolver el bot]
Historial relevante: [resumen en 1-2 oraciones de la conversación]

Siguiente acción sugerida: [llamar / confirmar visita / enviar cotización / tasar permuta]
```

---

## Qué hace el bot después de escalar

- Confirmar al lead que el equipo va a contactarlo
- No continuar intentando resolver lo que motivó el escalado
- Mantener el chat abierto para responder preguntas simples mientras espera
- Si el humano no responde en el tiempo esperado y el lead vuelve a escribir, avisar: "Ya dejé tu consulta con el equipo, están por contactarte."

---

## Falla si
- Escala sin pasar contexto al ticket
- Corta la conversación sin avisar al lead
- Sigue intentando resolver después de haber escalado
- No registra el motivo del escalado en el perfil del lead
- Escala por cualquier consulta sin evaluar si puede resolverla
