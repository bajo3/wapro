import React from "react";
import { format, isSameDay, parseISO } from "date-fns";

/**
 * A clean, tailwind‑only implementation of a ticket list item.  This
 * component eschews Material UI entirely in favour of semantic HTML
 * wrapped with utility classes.  It is designed with car dealerships
 * in mind: dark neutrals, spacious padding and bold accents.  The
 * vertical bar on the left reflects the queue colour; if none is
 * provided a default accent colour is used.
 *
 * Props:
 *  - ticket: the ticket object with at least id, status, contact,
 *    lastMessage, unreadMessages, queue and updatedAt fields.
 *  - onSelect: callback when the ticket is selected (clicked) and the
 *    status is not pending.
 *  - onAccept: callback when the accept button is clicked; only
 *    displayed when ticket.status === 'pending'.
 */
const TicketListItemTailwind = ({ ticket, onSelect, onAccept }) => {
  const handleClick = () => {
    if (ticket.status === "pending") return;
    onSelect?.(ticket.id);
  };

  const handleAccept = (e) => {
    e.stopPropagation();
    onAccept?.(ticket.id);
  };

  // Format the timestamp: if updated today show HH:mm, else show DD/MM/YYYY.
  const updatedAt = ticket?.updatedAt ? parseISO(ticket.updatedAt) : null;
  const formattedDate = updatedAt
    ? isSameDay(updatedAt, new Date())
      ? format(updatedAt, "HH:mm")
      : format(updatedAt, "dd/MM/yyyy")
    : "";

  const queueColour = ticket?.queue?.color || undefined;
  const leadSource = ticket?.contact?.leadSource;
  const botMode = String(ticket?.botMode || "ON").toUpperCase();

  return (
    <div
      className={`relative flex items-start p-4 cursor-pointer rounded-lg border border-auto-background bg-auto-surface shadow-ticket-soft hover:shadow-ticket transition-shadow duration-150 ${
        ticket.status === "pending" ? "opacity-80" : ""
      }`}
      onClick={handleClick}
    >
      {/* Vertical coloured bar indicating the queue */}
      <span
        className="absolute left-0 top-0 h-full w-1 rounded-l-lg"
        style={{ backgroundColor: queueColour || "#ef4444" }}
      ></span>
      {/* Avatar */}
      <img
        src={ticket?.contact?.profilePicUrl || "/anon.png"}
        alt={ticket?.contact?.name || "Sin nombre"}
        className="mr-4 h-10 w-10 flex-shrink-0 rounded-full object-cover"
      />
      {/* Main content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <h3 className="truncate text-base font-medium text-auto-primary">
            {ticket?.contact?.name || "Sin nombre"}
          </h3>
          {formattedDate && (
            <span className="ml-2 whitespace-nowrap text-xs font-normal text-auto-secondary">
              {formattedDate}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-baseline justify-between space-x-2">
          <p className="truncate text-sm text-auto-secondary flex-1">
            {ticket?.lastMessage || <span className="italic text-auto-muted">(sin mensaje)</span>}
          </p>
          {/* Unread messages badge */}
          {ticket?.unreadMessages > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-auto-accent px-2 py-0.5 text-xs font-semibold text-auto-surface">
              {ticket.unreadMessages}
            </span>
          )}
        </div>
        {/* Additional badges for lead source, bot mode and whatsapp name */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {leadSource && (
            <span
              className="inline-block rounded-full border border-auto-background bg-auto-accent px-2 py-0.5 text-[10px] font-semibold uppercase text-auto-surface"
              title="Lead source"
            >
              {String(leadSource).toUpperCase()}
            </span>
          )}
          {botMode === "HUMAN_ONLY" && (
            <span
              className="inline-block rounded-full border border-auto-background bg-auto-accent px-2 py-0.5 text-[10px] font-semibold uppercase text-auto-surface"
              title="Derivado a humano"
            >
              HUMANO
            </span>
          )}
          {ticket?.whatsappId && (
            <span
              className="inline-block rounded-full border border-auto-background bg-auto-accent px-2 py-0.5 text-[10px] font-semibold uppercase text-auto-surface"
              title="Conexión"
            >
              {ticket.whatsapp?.name || "WhatsApp"}
            </span>
          )}
        </div>
      </div>
      {/* Accept button for pending tickets */}
      {ticket.status === "pending" && (
        <button
          onClick={handleAccept}
          className="ml-4 self-center rounded-md bg-auto-open px-3 py-1 text-xs font-medium text-auto-surface shadow-sm hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          Aceptar
        </button>
      )}
    </div>
  );
};

export default TicketListItemTailwind;