import React from "react";
import { format, isSameDay, parseISO } from "date-fns";

const cn = (...classes) => classes.filter(Boolean).join(" ");

export default function TicketListItemTailwind({ ticket, isSelected, onSelect, onAccept }) {
  const lastAt = ticket?.updatedAt ? parseISO(ticket.updatedAt) : null;
  const lastLabel = lastAt
    ? isSameDay(lastAt, new Date())
      ? format(lastAt, "HH:mm")
      : format(lastAt, "dd/MM")
    : "";

  const queueColor = ticket?.queue?.color || "#64748b";
  const isPending = String(ticket?.status || "").toLowerCase() === "pending";
  const unread = Number(ticket?.unreadMessages || 0);
  const leadSource = ticket?.contact?.leadSource
    ? String(ticket.contact.leadSource).toUpperCase()
    : null;
  const botHumanOnly = String(ticket?.botMode || "ON").toUpperCase() === "HUMAN_ONLY";
  const waName = ticket?.whatsapp?.name || null;
  const lastMessage = String(ticket?.lastMessage || "").trim() || "Sin mensajes todavía";
  const initials = (ticket?.contact?.name || "?").trim().slice(0, 2).toUpperCase();

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-auto-lg border transition-all duration-150",
        isSelected
          ? "border-auto-accent/40 bg-auto-accent/[0.06] ring-1 ring-auto-accent/20"
          : "border-auto-border bg-auto-panel hover:border-auto-border2 hover:bg-auto-panel2"
      )}
    >
      {/* Cola color strip */}
      <span
        className="absolute left-0 top-0 h-full w-1"
        style={{ backgroundColor: queueColor }}
        aria-hidden="true"
      />

      <button
        type="button"
        onClick={() => !isPending && onSelect?.(ticket.id)}
        className={cn(
          "flex w-full gap-3 pl-4 pr-3 py-3 text-left",
          isPending ? "cursor-default pr-24" : "cursor-pointer"
        )}
      >
        {/* Avatar */}
        <div className="shrink-0">
          <div className="h-9 w-9 overflow-hidden rounded-full border border-auto-border bg-auto-panel2 flex items-center justify-center">
            {ticket?.contact?.profilePicUrl ? (
              <img
                src={ticket.contact.profilePicUrl}
                alt={ticket?.contact?.name || "Contacto"}
                className="h-full w-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-xs font-semibold text-auto-muted">{initials}</span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-auto-text leading-tight">
                {ticket?.contact?.name || "(Sin nombre)"}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {waName && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] bg-auto-panel2 border border-auto-border text-auto-hint">
                    {waName}
                  </span>
                )}
                {leadSource && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] bg-auto-accent/10 border border-auto-accent/20 text-auto-accent font-medium">
                    {leadSource}
                  </span>
                )}
                {botHumanOnly && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] bg-blue-500/10 border border-blue-500/20 text-blue-400">
                    HUMANO
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0 text-[11px] text-auto-hint">{lastLabel}</div>
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 truncate text-[12px] text-auto-hint leading-relaxed">
              {lastMessage}
            </div>
            {unread > 0 && (
              <div className="shrink-0 rounded-full bg-auto-open px-1.5 py-0.5 text-[11px] font-bold text-black min-w-[18px] text-center">
                {unread}
              </div>
            )}
          </div>
        </div>
      </button>

      {/* Accept button (pending) */}
      {isPending && (
        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
          <button
            type="button"
            onClick={() => onAccept?.(ticket.id)}
            className="h-8 rounded-auto-md bg-auto-accent px-3 text-xs font-bold text-black hover:bg-auto-accent2 transition-colors"
          >
            Aceptar
          </button>
        </div>
      )}
    </div>
  );
}
