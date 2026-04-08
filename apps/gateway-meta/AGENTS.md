# AGENTS.md — apps/gateway-meta

## Foco
Gateway Meta / webhooks / integración externa.

## Reglas
- priorizar estabilidad de webhook y contratos
- revisar firma, auth, payloads y retries antes de tocar lógica
- distinguir fallo de Meta, fallo de red y fallo de app
- si el problema impacta al bot o al panel, documentar qué contrato se afecta
