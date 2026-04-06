# Evaluación Fase 2 — Multi-intención y Múltiples Tipos (C)

## Objetivo
Validar que el bot maneja correctamente cuando el cliente menciona múltiples tipos de vehículo
o intenciones combinadas (compra + permuta + financiación).

---

## Casos de prueba

### CASO-MULTI-01: Dos tipos — presentar como alternativas con pregunta de uso
```
Input: "busco auto o SUV, no sé bien"
Expected behavior: NO ignorar uno. Presentar ambas como alternativas.
  Buena respuesta: "Podemos ver las dos opciones. ¿Lo usarías más para ciudad o para campo/familia? Con eso te digo cuál conviene."
  Mala respuesta: "Tenemos autos y SUVs disponibles."
Should invent: NO
Should escalate: no
Score target: 0.9
Flags: multipleVehicleTypes=true (2 tipos)
```

### CASO-MULTI-02: Tres o más tipos — pedir priorización directa
```
Input: "quiero un auto, también una moto y una camioneta para el campo"
Expected behavior: Pedir cuál es más urgente. NO intentar responder todo a la vez.
  Buena respuesta: "Buenísimo, varias cosas. ¿Por cuál arrancamos — el auto, la moto o la camioneta?"
  Mala respuesta: "Tenemos autos, motos y camionetas disponibles."
Should invent: NO
Should escalate: no
Score target: 0.95
Flags: multipleVehicleTypes=true (3+ tipos)
```

### CASO-MULTI-03: Multi-intención compra + permuta + financiación
```
Input: "quiero comprar una Hilux, tengo un Corolla para entregar y necesito financiar el resto"
Expected behavior: Responder en orden: primero buscar la Hilux, mencionar que anota la permuta del Corolla,
  preguntar anticipo para la financiación.
  NO mezclar todo en un bloque confuso.
Should invent: NO (no inventar condiciones de financiación ni permuta)
Should escalate: no (todavía no hay decisión de compra)
Score target: 0.9
```

### CASO-MULTI-04: Auto O camioneta con criterio de uso
```
Input: "no sé si comprar auto o camioneta"
Expected behavior: Preguntar uso para definir.
  Buena: "Depende del uso. ¿Lo usarías más para ciudad o para trabajo/campo? Con eso te digo cuál tiene más sentido."
  Mala: "Ambas opciones son excelentes."
Should invent: NO
Should escalate: no
Score target: 0.9
```

### CASO-MULTI-05: Intención de compra + intención de permuta simultáneas — orden correcto
```
Input: "me interesa el Cronos pero tengo un Sandero para entregar"
Expected behavior: Mostrar Cronos disponible PRIMERO, luego mencionar que se toma nota del Sandero como permuta.
  NO empezar pidiendo datos del Sandero antes de confirmar si hay stock del Cronos.
Should invent: NO
Should escalate: no (aún en etapa de exploración)
Score target: 0.85
```
