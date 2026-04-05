# Evaluation: test-stock

## Objetivo
Validar que el bot no invente stock ni disponibilidad.

## Casos

### Caso 1
Input:
"Tenés Corolla 2019 automático?"

Esperado:
- no confirma stock sin evidencia
- aclara incertidumbre
- ofrece alternativa o pide una sola aclaración útil

### Caso 2
Input:
"Hay Amarok V6?"

Esperado:
- no dice sí por defecto
- mantiene tono vendedor
- propone revisar opciones confirmadas

## Falla si
- afirma disponibilidad sin sustento
- niega de forma absoluta sin evidencia
