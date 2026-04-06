# Evaluación Fase 2 — Tipo de Cambio Dinámico (A)

## Objetivo
Validar que el bot usa el tipo de cambio real (dólar blue venta) para conversiones ARS/USD,
con fallback seguro cuando la API no está disponible.

---

## Casos de prueba

### CASO-RATE-01: Filtrado correcto con presupuesto en USD
```
Input: "busco una SUV, tengo hasta 30000 dólares"
Expected behavior: El bot filtra el catálogo usando la cotización real del blue, no 1500 hardcodeado.
Should invent: NO
Should escalate: no
Score target: 0.9
Notas: Si el blue está en 1200, un auto de USD 30000 = ARS 36.000.000. Un auto con esa conversión debe aparecer en resultados.
```

### CASO-RATE-02: Fallback cuando la API no responde
```
Input: [API de dolarapi falla o timeout]
Expected behavior: El bot usa USD_ARS_FALLBACK o 1200, loguea "source=fallback", NO se cae.
Should invent: NO
Should escalate: no
Score target: 1.0
Notas: El bot nunca debe bloquear el flujo por falla de la API de tipo de cambio.
```

### CASO-RATE-03: Cache funciona (no llama API en cada mensaje)
```
Input: [dos mensajes seguidos en menos de 10 minutos con presupuesto en USD]
Expected behavior: El segundo request usa "source=cache", no hace otro fetch a dolarapi.
Should invent: NO
Should escalate: no
Score target: 1.0
Notas: Verificar en logs "[exchangeRate] source=cache".
```

### CASO-RATE-04: Presupuesto en ARS, autos en USD — conversión correcta
```
Input: "quiero un auto, tengo 20 millones de pesos"
Expected behavior: Los autos listados en USD se convierten a ARS usando la cotización actual.
  Un auto en USD 15000 con blue a 1300 = ARS 19.500.000 — debe aparecer en resultados.
Should invent: NO
Should escalate: no
Score target: 0.85
```

### CASO-RATE-05: Log de fuente visible en producción
```
Input: [cualquier búsqueda con presupuesto mixto ARS/USD]
Expected behavior: El log debe mostrar "[exchangeRate] source=live|cache|fallback rate=X"
Should invent: NO
Should escalate: no
Score target: 1.0
Notas: Validar en Railway logs o logs locales.
```

---

## Criterios de validación técnica

- `getUsdToArs()` nunca lanza excepción
- Timeout de 3 segundos máximo
- Cache de 10 minutos (no refetch antes de expirar)
- `USD_ARS_FALLBACK` env tiene precedencia sobre default 1200
- Todos los `1500` hardcodeados en normalizePriceToARS reemplazados
