# Proyecto WaPro — Notas de Contexto (01/04/2026)

Este archivo resume la estructura actual del repositorio `wapro-main` y recoge notas sobre
cómo se integran sus distintos componentes y qué ajustes se han realizado recientemente
para mejorar el *intelligence* del bot y la coherencia del catálogo de vehículos.

## Estructura general

El monorrepo contiene varios subproyectos bajo el directorio `apps/`, cada uno con una
responsabilidad distinta:

| Carpeta               | Descripción                                                       |
|-----------------------|-------------------------------------------------------------------|
| `apps/bot`            | Servicio de bot de WhatsApp. Gestiona conversaciones, rules,
                          demandas de vehículos e integra la inteligencia con GPT‑4o. |
| `apps/gateway-meta`   | Gateway intermedio que expone servicios para páginas de vehículos,
                          consulta metadatos y formatea precios.                           |
| `apps/evolution-api`  | Integración con la API de evolución (proveedor de WhatsApp).      |
| `apps/evolution-manager` | Herramientas para gestionar instancias de WhatsApp.            |
| `apps/panel-whaticket` | Panel web (frontend + backend) usado por operadores para
                          administrar el bot, ver stock y configurar reglas.              |

Dentro de `panel-whaticket` hay dos directorios importantes:

* `backend`: API Express/Sequelize con rutas para autenticación, tickets,
  configuraciones y, más recientemente, un endpoint `/vehicles` para consultar el
  catálogo de vehículos. Este backend puede leer directamente de Supabase si se
  configura la variable de entorno `SUPABASE_DATABASE_URL`.
* `frontend`: Aplicación React/Vite que consume el backend mediante un cliente Axios
  (`src/services/api.js`) configurado con `VITE_BACKEND_URL`. La pestaña "Stock del bot"
  usa `GET /vehicles` para listar el inventario.

## Integración del catálogo de vehículos

Históricamente, los vehículos se almacenaban en la base de datos principal de Railway y
se sincronizaban manualmente con Supabase. Para simplificar el flujo y evitar
desincronizaciones se añadió en marzo de 2026 soporte para leer el catálogo directamente
desde Supabase. Este soporte existe en:

* `apps/bot/src/services/catalog.ts` (el bot lee desde Supabase cuando
  `SUPABASE_DATABASE_URL` está definido).
* `apps/panel-whaticket/backend/src/controllers/VehiclesController.ts`, que detecta la
  tabla y columnas de vehículos de forma robusta y respeta el contrato de respuesta
  `{ vehicles: [...] }`.

Para usar Supabase en cualquier servicio es necesario definir `SUPABASE_DATABASE_URL`
con la cadena de conexión del pooler de Supabase (puerto 6543). Sin esta variable,
los servicios intentarán usar la base de datos de Railway por defecto y, si esa base
no tiene la tabla de vehículos, el resultado será un catálogo vacío.

### Problema detectado

Se observó que el bot reportaba correctamente `29` vehículos en los logs de catálogo
(porque estaba usando Supabase), pero la pestaña **Stock del bot** en el panel web
seguía mostrando cero vehículos. El análisis reveló que:

1. El frontend de `panel-whaticket` llama a `GET /vehicles` de su propio backend.
2. El backend expone `/vehicles` y puede leer de Supabase, pero solo si
   `SUPABASE_DATABASE_URL` está definido.
3. En muchos despliegues esa variable no estaba configurada en el servicio del panel,
   por lo que la lectura se hacía contra la base de Railway (sin vehículos) y el
   frontend recibía una lista vacía.

### Solución aplicada

Se modificó `apps/panel-whaticket/backend/src/database/supabaseDb.ts` para hacer
un *fallback* inteligente: si `SUPABASE_DATABASE_URL` no está definido pero
`DATABASE_URL` apunta a un host de Supabase (`.supabase`), se usará esa cadena
de conexión como origen del pool. Esto permite que el backend del panel se
conecte a Supabase de forma automática en entornos donde solo `DATABASE_URL` está
presente, manteniendo la compatibilidad con el comportamiento anterior.

Con este cambio, el endpoint `/vehicles` del panel leerá del mismo origen que el
bot sin requerir variables adicionales, evitando que la pestaña "Stock del bot"
muestre un inventario vacío cuando Supabase es la fuente de verdad.

```ts
// Ejemplo resumido del fallback:
let rawUrl = process.env.SUPABASE_DATABASE_URL;
if (!rawUrl) {
  const fallback = process.env.DATABASE_URL;
  if (fallback && /supabase/i.test(fallback)) {
    rawUrl = fallback;
  }
}
// si rawUrl está definido, se crea el pool con SSL relajado...
```

### Recomendaciones

* **Configurar las variables de entorno**: se recomienda definir `SUPABASE_DATABASE_URL`
  en los servicios que consumen catálogo (`bot`, `panel-whaticket`, `gateway-meta`) para
  asegurar que siempre leen desde Supabase. Si se usa un único `DATABASE_URL` que ya
  apunta a Supabase, el fallback cubrirá la mayor parte de los casos.
* **Unificar consultas**: aunque cada servicio tiene su propia lógica para detectar la
  tabla de vehículos, sería conveniente centralizar la detección en un paquete común
  para reducir duplicación.
* **Documentación viva**: este archivo debe actualizarse cuando se incorporen nuevos
  servicios o se cambien contratos de API, de modo que futuras iteraciones del bot
  puedan comprender el contexto completo sin depender del conocimiento interno.

## Próximos pasos sugeridos

1. Implementar un endpoint de depuración (`/admin/catalog-debug`) en el panel para
   inspeccionar rápidamente la fuente del catálogo y los conteos de vehículos.
2. Mejorar la experiencia del usuario en la pestaña Stock permitiendo filtrar por
   concesionaria (`dealership_id`) y mostrando advertencias cuando el catálogo esté vacío
   por falta de configuración.
3. Consolidar la lógica de lectura de vehículos en un paquete compartido (por ejemplo,
   `@wapro/catalog`) que pueda ser importado tanto por el bot como por el panel.

Estas notas forman parte del proceso de mejora continua y pretenden servir de
referencia para desarrolladores y agentes que trabajen con el proyecto en el futuro.
