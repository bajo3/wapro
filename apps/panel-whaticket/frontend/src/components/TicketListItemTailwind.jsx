import React from "react";
const cn = (...classes) => classes.filter(Boolean).join(" ");
import { format, isSameDay, parseISO } from "date-fns";

/**
 * Tailwind-only ticket list item (Autos theme).
 *
 * Props
 * - ticket: ticket object from backend
 * - isSelected: boolean
 * - onSelect(id)
 * - onAccept(id)
 */
export default function TicketListItemTailwind({
  ticket,
  isSelected,
  onSelect,
  onAccept,
}) {
  const lastAt = ticket?.updatedAt ? parseISO(ticket.updatedAt) : null;
  const lastLabel = lastAt
    ? isSameDay(lastAt, new Date())
      ? format(lastAt, "HH:mm")
      : format(lastAt, "dd/MM/yyyy")
    : "";

  const queueColor = ticket?.queue?.color || "#64748b";
  const isPending = String(ticket?.status || "").toLowerCase() === "pending";
  const unread = Number(ticket?.unreadMessages || 0);

  const leadSource = ticket?.contact?.leadSource
    ? String(ticket.contact.leadSource).toUpperCase()
    : null;
  const botHumanOnly =
    String(ticket?.botMode || "ON").toUpperCase() === "HUMAN_ONLY";
  const waName = ticket?.whatsapp?.name || null;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-auto-lg border border-auto-border bg-auto-panel2",
        "transition hover:bg-auto-panel",
        isSelected && "ring-2 ring-auto-accent/40"
      )}
    >
      {/* Queue color rail */}
      <span
        className="absolute left-0 top-0 h-full w-1.5"
        style={{ backgroundColor: queueColor }}
        aria-hidden="true"
      />

      <button
        type="button"
        onClick={() => !isPending && onSelect?.(ticket.id)}
        className={cn(
          "flex w-full gap-3 p-3 text-left",
          isPending ? "cursor-default" : "cursor-pointer"
        )}
      >
        {/* Avatar */}
        <div className="shrink-0">
          <div className="h-10 w-10 overflow-hidden rounded-full border border-auto-border bg-auto-panel">
            {ticket?.contact?.profilePicUrl ? (
              <img
                src={ticket.contact.profilePicUrl}
                alt={ticket?.contact?.name || "Contacto"}
                className="h-full w-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-auto-muted">
                {(ticket?.contact?.name || "?")
                  .trim()
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-auto-text">
                {ticket?.contact?.name || "(Sin nombre)"}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {leadSource && (
                  <span className="rounded-full border border-auto-border bg-auto-panel px-2 py-0.5 text-[11px] text-auto-text">
                    {leadSource}
                  </span>
                )}
                {botHumanOnly && (
                  <span className="rounded-full border border-auto-border bg-auto-panel px-2 py-0.5 text-[11px] text-auto-text">
                    HUMANO
                  </span>
                )}
                {waName && (
                  <span className="rounded-full border border-auto-border bg-auto-panel px-2 py-0.5 text-[11px] text-auto-muted">
                    {waName}
                  </span>
                )}
              </div>
            </div>

            <div className="shrink-0 text-xs text-auto-muted">{lastLabel}</div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 truncate text-sm text-auto-muted">
              {ticket?.lastMessage || ""}
            </div>

            {unread > 0 && (
              <div className="shrink-0 rounded-full bg-auto-open px-2 py-0.5 text-xs font-semibold text-black">
                {unread}
              </div>
            )}
          </div>
        </div>
      </button>

      {/* Accept button overlay (pending only) */}
      {isPending && (
        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
          <button
            type="button"
            onClick={() => onAccept?.(ticket.id)}
            className="h-9 rounded-auto-md bg-auto-open px-3 text-sm font-semibold text-black hover:opacity-95"
          >
            Aceptar
          </button>
        </div>
      )}
    </div>
  );
}
