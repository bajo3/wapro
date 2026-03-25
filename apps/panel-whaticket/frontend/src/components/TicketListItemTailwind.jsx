import React from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { MessageCircleMore } from "lucide-react";

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
  const assignedTo = ticket?.user?.name || null;
  const lastMessage = String(ticket?.lastMessage || "").trim() || "Sin mensajes todavía";
  const initials = (ticket?.contact?.name || "?").trim().slice(0, 2).toUpperCase();

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-auto-lg border transition-all duration-150",
        isSelected
          ? "border-auto-accent/40 bg-auto-accent/[0.07] ring-1 ring-auto-accent/20"
          : "border-auto-border bg-auto-panel hover:border-auto-border2 hover:bg-auto-panel2"
      )}
    >
      <span
        className="absolute left-0 top-0 h-full w-1"
        style={{ backgroundColor: queueColor }}
        aria-hidden="true"
      />

      <button
        type="button"
        onClick={() => !isPending && onSelect?.(ticket.id)}
        className={cn(
          "flex w-full gap-3 px-4 py-3 text-left",
          isPending ? "cursor-default pr-[108px]" : "cursor-pointer"
        )}
      >
        <div className="shrink-0">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-auto-border bg-auto-panel2">
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

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold leading-tight text-auto-text">
                {ticket?.contact?.name || "(Sin nombre)"}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {waName ? (
                  <span className="rounded-full border border-auto-border bg-auto-surface px-2 py-0.5 text-[10px] text-auto-hint">
                    {waName}
                  </span>
                ) : null}

                {leadSource ? (
                  <span className="rounded-full border border-auto-accent/20 bg-auto-accent/10 px-2 py-0.5 text-[10px] font-medium text-auto-accent">
                    {leadSource}
                  </span>
                ) : null}

                {botHumanOnly ? (
                  <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
                    HUMANO
                  </span>
                ) : null}
              </div>
            </div>

            <div className="shrink-0 text-[11px] text-auto-hint">{lastLabel}</div>
          </div>

          <div className="mt-2 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div
                className="text-[12px] leading-5 text-auto-muted"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {lastMessage}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {assignedTo ? (
                  <span className="rounded-full border border-auto-border bg-auto-surface px-2 py-0.5 text-[10px] text-auto-hint">
                    Asesor: {assignedTo}
                  </span>
                ) : null}
                {ticket?.queue?.name ? (
                  <span className="rounded-full border border-auto-border bg-auto-surface px-2 py-0.5 text-[10px] text-auto-hint">
                    {ticket.queue.name}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              {unread > 0 ? (
                <div className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-auto-open px-2 py-0.5 text-[11px] font-bold text-black">
                  {unread}
                </div>
              ) : (
                <div className="rounded-full border border-auto-border bg-auto-surface p-1 text-auto-hint">
                  <MessageCircleMore className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          </div>
        </div>
      </button>

      {isPending ? (
        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
          <button
            type="button"
            onClick={() => onAccept?.(ticket.id)}
            className="inline-flex h-9 items-center rounded-auto-md bg-auto-accent px-3 text-xs font-bold text-black transition-colors hover:bg-auto-accent2"
          >
            Tomar
          </button>
        </div>
      ) : null}
    </article>
  );
}
