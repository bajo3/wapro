# Supabase direct source fix (2026-03-31)

## Problema
El bot mostraba stock `0` aunque Supabase tuviera vehículos.

## Causa raíz
La lectura del catálogo asumía una tabla y columnas rígidas (`public.vehicles`) y además filtraba por `status = active`.

## Fix
- autodetección de tabla/columnas vía `information_schema`
- filtro de status más tolerante
- `dealership_id` solo se aplica si existe
- logs del origen real y cantidad cargada

## Logs esperados
- `[catalog] using source public.vehicles`
- `[catalog] loaded 29 vehicles from public.vehicles`
