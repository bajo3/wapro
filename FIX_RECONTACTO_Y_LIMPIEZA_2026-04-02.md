# Fixes aplicados — 2026-04-02

## 1) Recontacto en Tickets
- Se corrigió el flujo en vista avanzada: el botón **Recontacto** ahora abre el panel lateral y enfoca la sección correcta.
- Se agregó bloque de **Recontacto** dentro de `LeadPanelAutos` con:
  - alta de recontacto agendado
  - fecha/hora opcional
  - mensaje editable
  - refresh de pendientes
  - cancelación de recontactos pendientes

## 2) Limpiar conversación
- Se agregó endpoint backend para limpiar la conversación de un ticket sin borrar el contacto ni el ticket.
- Al limpiar:
  - se borran los mensajes del ticket en el CRM
  - se resetea `lastMessage`
  - se resetea `unreadMessages`
  - el frontend recibe evento socket para vaciar la vista en tiempo real
- Se agregó acción de limpieza en:
  - menú de opciones del ticket
  - panel lateral de gestión / conversación

## Nota
- La limpieza actúa sobre el historial guardado en el CRM/panel.
- No se implementó borrado remoto en WhatsApp.
