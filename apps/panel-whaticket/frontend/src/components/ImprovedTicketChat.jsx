import React, { useMemo, useState } from "react";
import clsx from "clsx";

import {
  Calendar,
  ChevronLeft,
  FileText,
  Info,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useHistory } from "react-router-dom";

import MessagesList from "./MessagesList";
import MessageInput from "./MessageInput";

const statusLabelMap = {
  pending: "En cola",
  open: "Trabajando",
  closed: "Cerrado",
};

export default function ImprovedTicketChat({
  loading,
  ticketId,
  ticket,
  contact,
  onOpenContact,
  onToggleView,
  className,
}) {
  const history = useHistory();
  const [showQuickReplies, setShowQuickReplies] = useState(true);

  const displayName = contact?.name || "Contacto";
  const phone = contact?.number || contact?.phone || "";
  const leadSource = contact?.leadSource ? String(contact.leadSource).toUpperCase() : null;
  const statusKey = String(ticket?.status || "open").toLowerCase();
  const statusLabel = statusLabelMap[statusKey] || "Ticket";
  const botMode = String(ticket?.botMode || "ON").toUpperCase();
  const isHumanOnly = botMode === "HUMAN_ONLY";
  const assignedTo = ticket?.user?.name || null;
  const waName = ticket?.whatsapp?.name || null;

  const waLink = useMemo(() => {
    const digits = String(phone || "").replace(/[^\d]/g, "");
    if (!digits) return null;
    const normalized = digits.startsWith("54") ? digits : `54${digits}`;
    return `https://wa.me/${normalized}`;
  }, [phone]);

  const QUICK_REPLIES = useMemo(
    () => [
      { label: "Hola 👋", text: "Hola 👋 ¿cómo estás?" },
      {
        label: "Opciones",
        text: "¿Te paso opciones disponibles y formas de pago?",
      },
      {
        label: "Financiación",
        text: "¿Buscás financiación? Decime entrega + plazo y te simulo cuotas.",
      },
      {
        label: "Tomamos usado",
        text: "Sí, tomamos usado. ¿Qué auto tenés (año/km/versión) y cuánto pedís?",
      },
      {
        label: "Test drive",
        text: "¿Querés coordinar un test drive? Decime día y horario y lo agendamos.",
      },
    ],
    []
  );

  const prefill = (text) => {
    window.dispatchEvent(new CustomEvent("tickets:prefill", { detail: { text } }));
  };

  return (
    <div className={clsx("flex h-full min-h-0 flex-col bg-auto-panel", className)}>
      <div className="border-b border-auto-border bg-auto-panel px-3 py-3 md:px-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={() => history.push("/tickets")}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-auto-lg border border-auto-border bg-auto-surface text-auto-text hover:bg-auto-panel2 md:hidden"
              title="Volver a la lista"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-auto-border bg-auto-accent/10 text-auto-accent">
              <UserRound className="h-5 w-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="truncate text-base font-semibold text-auto-text">
                  {loading ? "Cargando…" : displayName}
                </div>
                <span className="rounded-full border border-auto-border bg-auto-surface px-2.5 py-1 text-[11px] font-medium text-auto-text">
                  {statusLabel}
                </span>
                {leadSource && (
                  <span className="rounded-full border border-auto-border bg-auto-surface px-2.5 py-1 text-[11px] text-auto-muted">
                    {leadSource}
                  </span>
                )}
                {isHumanOnly && (
                  <span className="rounded-full border border-auto-border bg-auto-surface px-2.5 py-1 text-[11px] text-auto-text">
                    HUMANO
                  </span>
                )}
              </div>

              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-auto-muted">
                {phone ? <span className="truncate">{phone}</span> : null}
                {assignedTo ? <span className="truncate">Asesor: {assignedTo}</span> : null}
                {waName ? <span className="truncate">Canal: {waName}</span> : null}
                {ticket?.id ? <span>Ticket #{ticket.id}</span> : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
            {waLink && (
              <a
                className="inline-flex h-9 items-center justify-center gap-1 rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-text hover:bg-auto-panel2"
                href={waLink}
                target="_blank"
                rel="noreferrer"
                title="Abrir en WhatsApp"
              >
                <PhoneCall className="h-4 w-4" />
                <span className="hidden sm:inline">WhatsApp</span>
              </a>
            )}

            <button
              type="button"
              onClick={() => onOpenContact?.()}
              className="inline-flex h-9 items-center gap-1 rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-text hover:bg-auto-panel2"
              title="Ver ficha del contacto"
            >
              <Info className="h-4 w-4" />
              <span>Ficha</span>
            </button>

            <button
              type="button"
              onClick={() => setShowQuickReplies((v) => !v)}
              className={clsx(
                "inline-flex h-9 items-center gap-1 rounded-auto-lg border border-auto-border px-3 text-xs font-medium",
                showQuickReplies
                  ? "bg-auto-accent text-white"
                  : "bg-auto-surface text-auto-text hover:bg-auto-panel2"
              )}
              title="Mostrar u ocultar mensajes rápidos"
            >
              <Sparkles className="h-4 w-4" />
              <span>Rápidos</span>
            </button>

            <button
              type="button"
              onClick={() => onToggleView?.()}
              className="inline-flex h-9 items-center gap-1 rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-text hover:bg-auto-panel2"
              title="Cambiar a vista clásica"
            >
              <MessageSquareText className="h-4 w-4" />
              <span className="hidden sm:inline">Vista clásica</span>
            </button>

            <button
              type="button"
              onClick={() => history.replace(`/tickets/${ticketId}`)}
              className="inline-flex h-9 items-center justify-center rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-text hover:bg-auto-panel2"
              title="Refrescar chat"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-muted"
              title="Cotizar (próximo paso)"
              disabled
            >
              <FileText className="h-4 w-4" />
            </button>

            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-muted"
              title="Agendar (próximo paso)"
              disabled
            >
              <Calendar className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {showQuickReplies && (
        <div className="border-b border-auto-border bg-auto-panel px-3 py-2 md:px-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {QUICK_REPLIES.map((qr) => (
              <button
                key={qr.label}
                type="button"
                onClick={() => prefill(qr.text)}
                className="shrink-0 rounded-full border border-auto-border bg-auto-surface px-3 py-1.5 text-xs text-auto-text hover:bg-auto-panel2"
              >
                {qr.label}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-auto-muted">
            Clic en un chip para precargar el mensaje.
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 bg-auto-surface">
        <MessagesList ticketId={ticketId} isGroup={ticket?.isGroup} />
      </div>

      <div className="border-t border-auto-border bg-auto-panel">
        <MessageInput ticketStatus={ticket?.status} />
      </div>
    </div>
  );
}
