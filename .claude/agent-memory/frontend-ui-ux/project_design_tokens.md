---
name: WaPro Design System Tokens
description: Tokens Tailwind y CSS variables del design system oscuro de WaPro
type: project
---

**Why:** El proyecto mezcla MUI legacy y Tailwind con tokens custom. Para mantener consistencia hay que usar los tokens `auto-*` de Tailwind (y las variables CSS `--wapro-*`) en todo componente nuevo o refactorizado.

**How to apply:** Siempre preferir las clases `auto-*` sobre valores hardcodeados. Para componentes MUI que no admiten clases Tailwind usar los valores hex directos del design system.

## Colores Tailwind (`auto-*`)

| Token | Valor | Uso |
|---|---|---|
| `auto-surface` | `#0f1117` | fondo general de página |
| `auto-panel` | `#171b26` | cards y paneles primarios |
| `auto-panel2` | `#1e2333` | paneles secundarios, inputs |
| `auto-panel3` | `#242a3a` | hover de paneles |
| `auto-border` | `rgba(255,255,255,0.08)` | bordes sutiles |
| `auto-border2` | `rgba(255,255,255,0.14)` | bordes en hover |
| `auto-text` | `#f1f5f9` | texto principal |
| `auto-muted` | `#94a3b8` | texto secundario |
| `auto-hint` | `#64748b` | texto terciario / placeholders |
| `auto-accent` | `#f59e0b` | amber, acción primaria |
| `auto-accent2` | `#fbbf24` | amber hover |
| `auto-open` | `#22c55e` | estado abierto/activo |
| `auto-pending` | `#f59e0b` | estado pendiente/cola |
| `auto-closed` | `#64748b` | estado cerrado |
| `auto-danger` | `#f43f5e` | acciones destructivas |

## Border Radius

| Token | Valor |
|---|---|
| `rounded-auto-sm` | 6px |
| `rounded-auto-md` | 8px |
| `rounded-auto-lg` | 12px |
| `rounded-auto-xl` | 16px |
| `rounded-auto-2xl` | 20px |

## Sombras

- `shadow-auto-soft` — `0 4px 24px rgba(0,0,0,0.35)` — sombra estándar de card
- `shadow-auto-xs` — `0 1px 4px rgba(0,0,0,0.2)` — chips/badges
- `shadow-auto-glow` — `0 0 16px rgba(245,158,11,0.15)` — glow accent

## Escala de spacing (base 4px)

Usar siempre múltiplos de 4: `p-1(4px)`, `p-2(8px)`, `p-3(12px)`, `p-4(16px)`, `p-5(20px)`, `p-6(24px)`, `p-8(32px)`.

## Badges de estado (CSS class)

`.wapro-badge-{draft|sent|accepted|rejected|open|pending|closed}` — definidas en `wapro-design-tokens.css`.
