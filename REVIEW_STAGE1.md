# Review Stage 1

## Hecho en esta pasada

### Tickets / UI
- Se rehízo la composición principal de `Tickets` para evitar solapamientos entre header antiguo, drawer y chat pro.
- Se eliminó la estructura que desplazaba el panel con `marginRight` negativo en la vista principal del ticket.
- Se dejó una `vista pro` limpia y una `vista clásica` como fallback.
- Se mejoró la cabecera del chat con mejor jerarquía: estado, lead source, asesor, canal y acciones rápidas.
- Se mejoró el sidebar: filtros más claros, búsqueda más descriptiva y cards de tickets con mejor lectura.
- Se corrigió el espacio interno de tickets pendientes para que el botón `Aceptar` no tape el contenido.
- Se reforzó `min-h-0` / `overflow` en contenedores para evitar layouts rotos dentro de flex.

## Revisión rápida de proyecto

### Hallazgos para próximas pasadas
1. `MessagesList` todavía tiene `console.log` de debug y lógica vieja mezclada con render complejo. Conviene limpiarlo.
2. Hay varios `setTimeout` de debounce manual. Conviene unificar con hooks reutilizables para evitar estados viejos.
3. `api-improved.js` y `api.js` parecen coexistir. Conviene consolidar una sola capa HTTP.
4. Hay logs de backend aún muy verbosos en `wbotMessageListener`, `MetaWebhookController`, `SendWhatsAppMedia` y scripts de sync.
5. La parte de tickets mezcla Material UI v4 + Tailwind en varios componentes. Conviene ir migrando por módulos completos para evitar inconsistencias visuales.
6. El flujo de `imageUrl`/`image_url` y persistencia de `image_url` sigue siendo candidato prioritario para próxima pasada.
7. `ContactDrawer` tiene bastante responsabilidad junta: tags, notas, historial, recontacto. Conviene separar por subcomponentes.

## Pruebas realizadas
- Revisión estructural de imports y dependencias en los archivos modificados.
- Revisión manual de layout y flujo del módulo Tickets a nivel código.
- No pude correr `vite build` en este entorno porque `vite` no está disponible localmente en el contenedor.

## Próximo paso recomendado
- Segunda pasada enfocada en `MessagesList` + `MessageInput` + persistencia de media/image_url.
