import React from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { MessageCircleMore } from "lucide-react";

const cn = (...classes) => classes.filter(Boolean).join(" ");

// ── Helpers de temperatura / scoring (Fase 4) ─────────────────────────────────
const TEMP_CONFIG = {
  hot:  { label: "HOT",  bg: "bg-red-500/15",    border: "border-red-500/30",    text: "text-red-400",    dot: "bg-red-500"    },
  warm: { label: "TIBIO",bg: "bg-amber-500/15",  border: "border-amber-500/30",  text: "text-amber-400",  dot: "bg-amber-500"  },
  cold: { label: "FRÍO", bg: "bg-slate-500/10",  border: "border-slate-500/20",  text: "text-slate-400",  dot: "bg-slate-500"  },
};

const PRIORITY_DOT = {
  5: "bg-red-500",
  4: "bg-orange-400",
  3: "bg-amber-400",
  2: "bg-blue-400",
  1: "bg-slate-500",
};

const INTENT_LABEL = {
  buy_intent:          "Compra",
  visit_intent:        "Visita",
  financing_intent:    "Financiación",
  trade_in_intent:     "Permuta",
  urgent_purchase:     "Urgente",
  follow_up_reengaged: "Retomó",
  compare_vehicles:    "Comparando",
  price_check:         "Precio",
  availability_check:  "Stock",
  just_browsing:       "Mirando",
  objection:           "Objeción",
  reclamo:             "Reclamo",
};

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

  // ── Datos comerciales Fase 4 ──────────────────────────────────────────────
  const cd = ticket?.commercialData || null;
  const temperature = cd?.lead_temperature || null;
  const leadScore = cd?.lead_score != null ? Number(cd.lead_score) : null;
  const primaryIntent = cd?.primary_intent || null;
  const commercialPriority = cd?.commercial_priority != null ? Number(cd.commercial_priority) : null;
  const shouldNotify = Boolean(cd?.should_notify_human);
  const nextActionLabel = cd?.next_best_action
    ? String(cd.next_best_action).replace(/_/g, " ")
    : null;
  const tempCfg = temperature ? TEMP_CONFIG[temperature] : null;

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
          "flex w-full gap-3 px-3 py-3 text-left",
          isPending ? "cursor-default pr-[112px]" : "cursor-pointer"
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

                {/* ── Fase 4: temperatura + score ───────────────────────────── */}
                {tempCfg ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      tempCfg.bg, tempCfg.border, tempCfg.text
                    )}
                    title={`Score: ${leadScore ?? "?"}/100`}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", tempCfg.dot)} />
                    {tempCfg.label}
                    {leadScore != null ? (
                      <span className="opacity-70 font-normal">{leadScore}</span>
                    ) : null}
                  </span>
                ) : null}

                {/* ── Fase 4: intención ─────────────────────────────────────── */}
                {primaryIntent && INTENT_LABEL[primaryIntent] ? (
                  <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400">
                    {INTENT_LABEL[primaryIntent]}
                  </span>
                ) : null}

                {/* ── Fase 4: alerta de notificación humana ────────────────── */}
                {shouldNotify ? (
                  <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400">
                    ACCION
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
        <div className="absolute inset-y-0 right-0 flex items-center pr-2.5">
          <button
            type="button"
            onClick={() => onAccept?.(ticket.id)}
            className="inline-flex h-8 items-center rounded-auto-md bg-auto-accent px-3 text-[12px] font-bold text-black transition-colors hover:bg-auto-accent2"
          >
            Tomar
          </button>
        </div>
      ) : null}
    </article>
  );
}
