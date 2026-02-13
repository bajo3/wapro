import React, { useMemo, useState } from "react";
import clsx from "clsx";

import { Calendar, FileText, Info, PhoneCall, Sparkles } from "lucide-react";

// Reuse existing chat plumbing (no behavior fork)
import MessagesList from "../MessagesList";
import MessageInput from "../MessageInput";

/**
 * ImprovedTicketChat
 *
 * Goal: provide a cleaner, space-efficient chat header + quick actions,
 * while reusing existing MessagesList/MessageInput and the current back-end.
 *
 * This component intentionally does NOT try to persist new "lead" fields.
 * For editing/notes/tags, keep using ContactDrawer (opened via onOpenContact).
 */
export default function ImprovedTicketChat({
  ticketId,
  ticket,
  contact,
  onOpenContact,
  className,
}) {
  const [showQuickReplies, setShowQuickReplies] = useState(true);

  const displayName = contact?.name || "Contacto";
  const phone = contact?.number || contact?.phone || "";

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

  // Prefill text in the existing MessageInput. We inject via a window event to
  // avoid touching the MessageInput internals too aggressively.
  const prefill = (text) => {
    window.dispatchEvent(
      new CustomEvent("tickets:prefill", { detail: { text } })
    );
  };

  return (
    <div className={clsx("flex h-full min-h-0 flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-auto-border bg-auto-panel px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-9 w-9 shrink-0 rounded-full bg-auto-accent/15 ring-1 ring-auto-border" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-auto-text">
              {displayName}
            </div>
            <div className="truncate text-xs text-auto-muted">{phone}</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {waLink && (
            <a
              className="inline-flex items-center justify-center rounded-auto-lg px-2 py-1 text-xs font-medium text-auto-text hover:bg-auto-surface"
              href={waLink}
              target="_blank"
              rel="noreferrer"
              title="Abrir en WhatsApp"
            >
              <PhoneCall className="h-4 w-4" />
            </a>
          )}

          <button
            type="button"
            onClick={() => onOpenContact?.()}
            className="inline-flex items-center gap-1 rounded-auto-lg px-2 py-1 text-xs font-medium text-auto-text hover:bg-auto-surface"
            title="Ver ficha / acciones del contacto"
          >
            <Info className="h-4 w-4" />
            <span className="hidden sm:inline">Ficha</span>
          </button>

          <button
            type="button"
            onClick={() => setShowQuickReplies((v) => !v)}
            className={clsx(
              "inline-flex items-center gap-1 rounded-auto-lg px-2 py-1 text-xs font-medium hover:bg-auto-surface",
              showQuickReplies ? "text-auto-text" : "text-auto-muted"
            )}
            title="Mensajes rápidos"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Rápidos</span>
          </button>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-auto-lg px-2 py-1 text-xs font-medium text-auto-muted hover:bg-auto-surface"
            title="Cotizar (próximo)"
            disabled
          >
            <FileText className="h-4 w-4" />
          </button>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-auto-lg px-2 py-1 text-xs font-medium text-auto-muted hover:bg-auto-surface"
            title="Agendar (próximo)"
            disabled
          >
            <Calendar className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Quick replies */}
      {showQuickReplies && (
        <div className="border-b border-auto-border bg-auto-panel px-3 py-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {QUICK_REPLIES.map((qr) => (
              <button
                key={qr.label}
                type="button"
                onClick={() => prefill(qr.text)}
                className="shrink-0 rounded-full border border-auto-border bg-auto-surface px-3 py-1 text-xs text-auto-text hover:bg-auto-panel"
              >
                {qr.label}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-auto-muted">
            Tip: clic en un chip para pre-cargar el texto.
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="min-h-0 flex-1">
        <MessagesList ticketId={ticketId} isGroup={ticket?.isGroup} />
      </div>

      {/* Input */}
      <div className="border-t border-auto-border bg-auto-panel">
        <MessageInput ticketStatus={ticket?.status} />
      </div>
    </div>
  );
}
