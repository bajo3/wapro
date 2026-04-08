---
name: dev-tdd
description: Usar cuando implementás cualquier feature o bugfix, ANTES de escribir código de implementación. Red-Green-Refactor. Solo para tareas técnicas. NO usar en flujos comerciales o del bot.
---

# Test-Driven Development — WaPro

## Iron Law

```
NO HAY CÓDIGO DE PRODUCCIÓN SIN UN TEST QUE FALLE PRIMERO
```

¿Escribiste código antes del test? Borralo. Empezá de cero.

## Red-Green-Refactor

### RED — Escribí el test que falla

Un test mínimo que muestra qué debería pasar.

```typescript
// Bien: claro, testea comportamiento real
test('rechaza mensaje vacío de WhatsApp', async () => {
  const result = await processMessage({ body: '' });
  expect(result.action).toBe('ignore');
});

// Mal: vago, testea el mock no el código
test('funciona', async () => {
  const mock = jest.fn().mockResolvedValue('ok');
  await processMessage(mock);
  expect(mock).toHaveBeenCalled();
});
```

**Requisitos:**
- Un comportamiento por test
- Nombre describe el comportamiento
- Código real (mocks solo si son inevitables)

### Verificá RED — Mirá que falle

**OBLIGATORIO. Nunca saltear.**

```bash
npm test -- path/to/test.test.ts
```

Confirmá:
- El test falla (no error de sintaxis)
- El mensaje de fallo es el esperado
- Falla porque la feature no existe, no por typo

**¿El test pasa inmediatamente?** Estás testeando comportamiento que ya existe. Corregí el test.

### GREEN — Código mínimo

Escribí el código más simple para que el test pase. Nada más.

No agregues features, no refactorices otra cosa, no "mejorés" más allá del test.

### Verificá GREEN

```bash
npm test -- path/to/test.test.ts
```

Confirmá que el test pasa Y que otros tests no rompieron.

### REFACTOR — Limpiá

Solo después de estar en verde:
- Eliminá duplicación
- Mejorá nombres
- Extraé helpers

Mantené los tests en verde. No agregues comportamiento.

## Contexto WaPro

Para el bot: los tests de comportamiento van en `apps/bot/src/__tests__/` o junto al módulo. Si hay duda sobre cómo correr los tests en el monorepo, revisá `docs/RUNTIME_MAP.md` primero.

## Checklist antes de marcar completo

- [ ] Cada función nueva tiene un test
- [ ] Vi cada test fallar antes de implementar
- [ ] Cada test falló por la razón esperada (feature faltante, no typo)
- [ ] Escribí código mínimo para pasar cada test
- [ ] Todos los tests pasan
- [ ] Sin errores ni warnings en el output

## Racionalizaciones comunes — STOP

| Excusa | Realidad |
|---|---|
| "Es muy simple para testear" | Simple rompe igual. El test tarda 30 segundos. |
| "Lo testeo después para confirmar" | Tests-after pasan inmediatamente → no prueban nada. |
| "Ya lo probé manualmente" | Manual no es sistemático. No podés re-correrlo en cada deploy. |
| "Borrar horas de trabajo es un desperdicio" | Sunk cost. Código sin test real = deuda técnica. |
| "TDD me frena" | TDD es más rápido que debuggear en producción. |

## Bugs

Bug encontrado → escribí test que lo reproduce → seguí TDD. Nunca fijés bugs sin test.
