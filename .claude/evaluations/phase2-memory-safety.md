# Evaluación Fase 2 — Seguridad de la Memoria Conversacional (G)

## Objetivo
Validar que botMemory nunca guarda ni inyecta datos de catálogo (precios, stock, disponibilidad),
solo patrones conversacionales seguros.

---

## Casos de prueba

### CASO-MEM-01: isSafeToLearn rechaza datos de catálogo
```
Test: isSafeToLearn("el precio del Cronos es 18 millones")
Expected: false
Notas: La palabra "precio" está en FORBIDDEN_IN_MEMORY.
```

```
Test: isSafeToLearn("tenemos stock disponible del modelo")
Expected: false
Notas: "stock" y "disponible" están prohibidos.
```

```
Test: isSafeToLearn("para recomendarte mejor, ¿para qué lo usarías?")
Expected: true
Notas: Es un patrón conversacional puro, sin datos de catálogo.
```

### CASO-MEM-02: El archivo bot-memory.json nunca contiene precios o stock
```
Input: [conversación con múltiples interacciones sobre precios]
Expected behavior: apps/bot/data/bot-memory.json NO debe contener:
  - números de precio
  - palabras "stock", "disponible", "cuotas", "financiación"
  - datos específicos de vehículos (año, km, versión)
Should invent: NO
Score target: 1.0
```

### CASO-MEM-03: La memoria se inicializa correctamente en arranque
```
Test: arrancar el bot sin bot-memory.json existente
Expected: el bot arranca sin errores, loadBotMemory() devuelve store vacío.
Log esperado: "[botMemory] Memoria inicializada vacía (primer arranque)."
Score target: 1.0
```

### CASO-MEM-04: La memoria se carga correctamente en reinicios
```
Test: guardar patrones, reiniciar el bot, verificar que persisten.
Expected: los patrones del run anterior están disponibles en el nuevo run.
Score target: 1.0
```

### CASO-MEM-05: FIFO funciona — máximo 100 patrones por categoría
```
Test: registrar 110 patrones conversacionales
Expected: solo los últimos 100 están en memoria (los primeros 10 fueron descartados).
Score target: 1.0
```

### CASO-MEM-06: La memoria inyectada al prompt está marcada como "ejemplo"
```
Input: cliente indeciso + preguntas guardadas en usefulQuestions
Expected behavior: el bloque inyectado al prompt dice:
  "PREGUNTAS EFECTIVAS PARA CLIENTES INDECISOS (ejemplos de conversaciones reales)"
  y NO dice "regla", "siempre", "catálogo" o similar.
Should invent: NO
Score target: 1.0
```

### CASO-MEM-07: Falla de disco no bloquea el bot
```
Test: simular error de escritura en bot-memory.json (disco lleno / permisos)
Expected: el bot sigue funcionando, loguea el error, NO lanza excepción.
Score target: 1.0
```

### CASO-MEM-08: Las métricas de turno detectan respuestas largas
```
Input: bot responde con más de 500 caracteres
Expected: log "[botMemory] Flag: respuesta larga (X chars) en conversación..."
Score target: 1.0
```

### CASO-MEM-09: Las métricas detectan múltiples preguntas en un turno
```
Input: bot responde con 2+ signos de pregunta (?)
Expected: log "[botMemory] Flag: múltiples preguntas (X) en conversación..."
Score target: 1.0
```
