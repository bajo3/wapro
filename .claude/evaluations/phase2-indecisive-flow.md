# Evaluación Fase 2 — Flujo Guiado para Indecisos (B)

## Objetivo
Validar que el bot conduce al cliente indeciso con UNA pregunta por turno,
no repite preguntas ya respondidas, y pasa a sugerir opciones al llegar a 3 datos útiles.

---

## Casos de prueba

### CASO-IND-01: Primer mensaje indeciso — pregunta correcta
```
Input: "no sé bien qué busco, ayudame a elegir"
Expected behavior: UNA pregunta: uso (ciudad/ruta/familia/trabajo) + presupuesto en la misma pregunta.
  Ejemplo bueno: "Para recomendarte bien — ¿para qué lo usarías más: ciudad, ruta, familia o trabajo? ¿Y tenés presupuesto en mente?"
  Ejemplo malo: "¿Cuál es tu marca favorita? ¿Cuánto querés gastar? ¿Automático o manual?"
Should invent: NO
Should escalate: no
Score target: 0.9
Flags: isIndecisive=true, guidedFlowStep=0
```

### CASO-IND-02: Segunda vuelta — NO repetir uso si ya lo dijo
```
Context: cliente ya dijo "para la ciudad"
Input: "tengo como 15 millones"
Expected behavior: NO preguntar uso de vuelta. Preguntar tipo (hatch/sedan/SUV) o caja.
Should invent: NO
Should escalate: no
Score target: 0.9
Flags: isIndecisive=true, primaryUse=city, maxPrice=15000000
```

### CASO-IND-03: Con 3+ datos — pasar a sugerir opciones
```
Context: uso=ciudad, presupuesto=15M, tipo=hatch
Input: "no sé, lo que me digas"
Expected behavior: NO hacer más preguntas. Mostrar 2 opciones concretas del catálogo.
  Terminar con "¿Cuál de estas se acerca más a lo que buscás?"
Should invent: NO (solo autos reales del catálogo)
Should escalate: no
Score target: 0.95
Flags: isIndecisive=true, countUsefulGuidedAnswers >= 3
```

### CASO-IND-04: No entrar en loop infinito de preguntas
```
Escenario: el bot preguntó uso en turno 1, el cliente no respondió, preguntó de nuevo en turno 2.
Expected behavior: En turno 3 NO volver a preguntar lo mismo. Avanzar con lo que tiene o mostrar opciones populares.
Should invent: NO
Should escalate: no
Score target: 0.85
Notas: Verificar repeatedMissingFields en loopData.
```

### CASO-IND-05: Tono consultivo, no de encuesta
```
Input: "no sé qué elegir"
Expected behavior: El bot no suena como formulario.
  Mal: "Necesito saber: 1) ¿Uso? 2) ¿Presupuesto? 3) ¿Caja?"
  Bien: "Para recomendarte algo que valga — ¿para qué lo usarías más?"
Should invent: NO
Should escalate: no
Score target: 0.9
```

### CASO-IND-06: 5 preguntas del flujo en orden correcto
```
Orden esperado si el cliente no da ningún dato:
  1. Uso (ciudad/ruta/campo/mixto)
  2. Presupuesto
  3. Tipo preferido (chico/sedan/SUV)
  4. Caja (automático/manual)
  5. Prioridad puntual (consumo/espacio/seguridad)
Expected behavior: el flujo avanza en ese orden, solo 1 pregunta por turno.
Should invent: NO
Should escalate: no
Score target: 0.85
```
