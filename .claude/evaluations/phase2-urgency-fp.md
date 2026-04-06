# Evaluación Fase 2 — Falsos Positivos de Urgencia (E)

## Objetivo
Validar que el bot distingue urgencia temporal (debe escalar) de urgencia adjetival (no debe escalar).
Reducir handoffs innecesarios que interrumpen conversaciones de exploración normal.

---

## Casos de prueba

### CASO-URG-01: "urgente" adjetival — NO escalar
```
Input: "quiero algo urgente que sea barato y no gaste mucha nafta"
Expected behavior: El bot NO interpreta "urgente" como urgencia temporal.
  "Urgente" aquí es adjetivo de la búsqueda (quiere algo que no falle, que sea confiable/rápido).
  Debe responder con opciones filtradas por presupuesto/combustible, SIN handoff.
Should escalate: NO
Score target: 0.95
Flags: highUrgency=false (regex temporal no matchea), wantsHandoff=false
```

### CASO-URG-02: "urgente" con fecha — SÍ escalar
```
Input: "lo necesito urgente, lo necesito esta semana"
Expected behavior: El bot detecta urgencia temporal ("esta semana") y escala.
  handoffRecommended=true, ofrecer contacto inmediato con asesor.
Should escalate: SÍ
Score target: 0.95
Flags: highUrgency=true (regex temporal matchea), hasTemporalUrgency=true
```

### CASO-URG-03: "lo necesito ya" — SÍ escalar
```
Input: "lo necesito ya, ¿tienen algo disponible ahora?"
Expected behavior: Escala — "ya" con contexto de inmediatez es urgencia temporal.
Should escalate: SÍ
Score target: 0.9
```

### CASO-URG-04: "para mañana" — SÍ escalar
```
Input: "necesito el auto para mañana, ¿es posible?"
Expected behavior: Escala — fecha concreta inmediata.
Should escalate: SÍ
Score target: 0.95
```

### CASO-URG-05: "urgente" como énfasis — NO escalar
```
Input: "urgente necesito un auto barato"
Expected behavior: NO escalar. "Urgente" al inicio es énfasis, no fecha.
  Sin "esta semana", "mañana", "ya mismo", no hay urgencia temporal.
Should escalate: NO
Score target: 0.85
Notas: caso ambiguo — aceptable si escala con baja confianza, pero idealmente no escala.
```

### CASO-URG-06: Reclamo — SÍ escalar (sin importar urgencia)
```
Input: "me mandaron mal el auto, estoy furioso"
Expected behavior: Siempre escala por reclamo.
  handoffType=complaint, respuesta empática, sin intentar vender.
Should escalate: SÍ
Score target: 1.0
```

### CASO-URG-07: Log estructurado de handoff visible
```
Input: [cualquier mensaje que triggerea handoff]
Expected behavior: Log "[HANDOFF_TRIGGER]" con JSON que incluye reason, input (primeros 100 chars),
  flags y timestamp.
Score target: 1.0
Notas: Verificar en Railway logs o logs locales.
```

---

## Regex de urgencia temporal (implementado en extract.ts)

Debe matchear:
- "esta semana"
- "la semana que viene"
- "para mañana"
- "para el lunes/martes/..." (día de la semana)
- "lo necesito ya"
- "lo necesito rápido"
- "ya mismo"
- "cuanto antes"
- "urgente porque/para/que lo necesito"

NO debe matchear:
- "urgente" solo como adjetivo
- "urgente" al inicio de frase sin contexto temporal
- "algo urgente" describiendo el tipo de auto
