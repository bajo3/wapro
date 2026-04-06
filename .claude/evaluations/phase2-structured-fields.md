# Evaluación Fase 2 — Extracción de Campos Estructurados Nuevos (D)

## Objetivo
Validar que los nuevos campos seatCount, primaryUse, fuelPreference y transmissionPreference
se extraen correctamente desde lenguaje natural argentino.

---

## Casos de prueba

### CASO-FIELD-01: seatCount detectado
```
Input: "busco algo para 7 personas"
Expected extraction: seatCount=7
Should invent: NO
Score target: 1.0
```

```
Input: "necesito 7 asientos"
Expected extraction: seatCount=7
Score target: 1.0
```

```
Input: "para 5 plazas mínimo"
Expected extraction: seatCount=5
Score target: 0.9
```

### CASO-FIELD-02: primaryUse detectado
```
Input: "lo voy a usar principalmente para la ciudad"
Expected extraction: primaryUse='city'
Score target: 1.0
```

```
Input: "viajo mucho por ruta"
Expected extraction: primaryUse='highway'
Score target: 0.9
```

```
Input: "tengo campo, necesito algo para caminos de tierra"
Expected extraction: primaryUse='field'
Score target: 0.9
```

```
Input: "lo uso de todo, ciudad y ruta"
Expected extraction: primaryUse='mixed'
Score target: 0.9
```

### CASO-FIELD-03: fuelPreference detectado
```
Input: "prefiero nafta"
Expected extraction: fuelPreference='gasoline'
Score target: 1.0
```

```
Input: "que sea diesel, viajo mucho"
Expected extraction: fuelPreference='diesel'
Score target: 1.0
```

```
Input: "me interesa algo híbrido"
Expected extraction: fuelPreference='hybrid'
Score target: 1.0
```

```
Input: "busco eléctrico, 100% EV"
Expected extraction: fuelPreference='electric'
Score target: 1.0
```

### CASO-FIELD-04: transmissionPreference detectado
```
Input: "tiene que ser automático"
Expected extraction: transmissionPreference='automatic'
Score target: 1.0
```

```
Input: "prefiero a palanca"
Expected extraction: transmissionPreference='manual'
Score target: 1.0
```

```
Input: "me da lo mismo la caja"
Expected extraction: transmissionPreference=undefined (no detectar nada)
Score target: 1.0
Notas: cuando el cliente no expresa preferencia, el campo debe quedar undefined — no false, no null.
```

### CASO-FIELD-05: Campos nuevos no sobreescriben campos existentes
```
Context: fuel='gnc' ya establecido
Input: "busco algo bueno para la ruta"
Expected extraction: fuelPreference no se setea porque fuel ya está definido.
Score target: 1.0
Notas: fuelPreference es complementario a fuel, no lo reemplaza.
```

### CASO-FIELD-06: Los nuevos campos se pasan al prompt del agente
```
Input: "busco SUV 7 asientos, diesel, automático, uso mixto"
Expected behavior: El agente muestra en DATA YA CONOCIDA:
  - asientos requeridos: 7
  - combustible: diesel
  - caja: automatico
  - uso: mixed
Should invent: NO
Score target: 0.95
```
