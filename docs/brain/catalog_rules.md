# Reglas del catálogo

## Fuente de verdad
Supabase debe ser la fuente principal del catálogo.

## Reglas clave
- No exigir `status='active'` de forma rígida.
- Excluir solo estados claramente inactivos: `inactive`, `archived`, `deleted`, `sold`, `paused`.
- Soportar sinónimos de columnas: `brand/marca`, `model/modelo`, `price/precio`.
- Soportar `pictures` como array o JSON string.
- Reutilizar último cache bueno si una lectura fresca devuelve 0 de forma transitoria.

## Matching
- Buscar por marca, modelo, versión, año, km, transmisión, combustible, carrocería.
- Si hay matches fuertes, el bot debe mostrar autos y no responder genérico.
