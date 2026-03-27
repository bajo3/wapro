# Notas de implementación para WaPro

## 1. Entradas recomendadas
El orquestador debería recibir:
- pedido del usuario
- módulo afectado
- contexto corto
- hechos confirmados
- restricciones
- output esperado

## 2. Flujo recomendado para bugs
1. Chief of Staff
2. especialista principal
3. segundo especialista si hay riesgo cruzado
4. Conversation Judge
5. respuesta final

## 3. Flujo recomendado para inteligencia del bot
1. Chief of Staff
2. bot-sales-brain
3. revenue-commander
4. catalog-truth-guardian si hay catálogo/precios
5. prompt-training-manager para sistematizar mejora
6. conversation-judge

## 4. Flujo recomendado para features CRM
1. Chief of Staff
2. crm-product-owner
3. frontend-ui-ux o backend-fixer
4. test-qa-guard
5. conversation-judge

## 5. Error corregido del pack original
`data-sync-catalog.md` tenía una description inconsistente; en este pack quedó alineada al dominio de datos/catálogo.
