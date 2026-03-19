import React, { useMemo, useState } from "react";
import clsx from "clsx";
import { toast } from "react-toastify";

import api from "../services/api";
import toastError from "../errors/toastError";

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
// Replace the Material‑UI based MessageInput with a simplified Tailwind component.
import ImprovedMessageInput from "./ImprovedMessageInput";

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
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const displayName = contact?.name || "Contacto";
  const phone = contact?.number || contact?.phone || "";
  const leadSource = contact?.leadSource ? String(contact.leadSource).toUpperCase() : null;
  const statusKey = String(ticket?.status || "open").toLowerCase();
  const statusLabel = statusLabelMap[statusKey] || "Ticket";
  const botMode = String(ticket?.botMode || "ON").toUpperCase();
  const isHumanOnly = botMode === "HUMAN_ONLY";
  const assignedTo = ticket?.user?.name || null;
  const waName = ticket?.whatsapp?.name || null;
  const botModeLabel = isHumanOnly ? "Humano" : botMode === "OFF" ? "Off" : "Auto";
  const agentData = ticket?.agentData || null;
  const leadScore = Number(ticket?.leadScore || 0) || 0;
  const leadTemp = leadScore >= 70 ? "Caliente" : leadScore >= 40 ? "Tibio" : "Frío";

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

  const submitAgentFeedback = async (verdict) => {
    if (!ticketId || !agentData || feedbackLoading) return;
    setFeedbackLoading(true);
    try {
      await api.post(`/tickets/${ticketId}/agent-feedback`, {
        verdict,
        finalReply: verdict === "edited" ? null : agentData?.suggestedReply || null
      });
      toast.success(
        verdict === "approved"
          ? "Feedback guardado: sugerencia aprobada"
          : verdict === "handoff"
            ? "Feedback guardado: derivación sugerida"
            : "Feedback guardado"
      );
    } catch (err) {
      toastError(err);
    } finally {
      setFeedbackLoading(false);
    }
  };

  return (
    <div className={clsx("flex h-full min-h-0 flex-col overflow-hidden bg-auto-panel", className)}>
      <div className="shrink-0 border-b border-auto-border bg-auto-panel px-3 py-3 md:px-4">
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
              onClick={() => onOpenContact?.(1)}
              className="inline-flex h-9 items-center gap-1 rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-text hover:bg-auto-panel2"
              title="Abrir gestión del ticket"
            >
              <Info className="h-4 w-4" />
              <span>Gestión</span>
            </button>

            <button
              type="button"
              onClick={() => history.push("/quotations")}
              className="inline-flex h-9 items-center gap-1 rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-text hover:bg-auto-panel2"
              title="Abrir cotizaciones"
            >
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Cotización</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenContact?.(1)}
              className="inline-flex h-9 items-center gap-1 rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-text hover:bg-auto-panel2"
              title="Abrir recontactos y mensajes programados"
            >
              <Calendar className="h-4 w-4" />
              <span className="hidden sm:inline">Recontacto</span>
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

            <span className="inline-flex h-9 items-center rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-muted">
              Bot: {botModeLabel}
            </span>

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

          </div>
        </div>
      </div>

      {showQuickReplies && (
        <div className="shrink-0 border-b border-auto-border bg-auto-panel px-3 py-2 md:px-4">
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

      {agentData ? (
        <div className="shrink-0 border-b border-auto-border bg-auto-panel px-3 py-3 md:px-4">
          <div className="rounded-auto-xl border border-auto-border bg-auto-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-auto-border bg-auto-panel px-2.5 py-1 text-[11px] font-medium text-auto-text">
                <Sparkles className="h-3.5 w-3.5" /> Agente
              </span>
              {agentData?.intent ? (
                <span className="rounded-full border border-auto-border bg-auto-panel px-2.5 py-1 text-[11px] text-auto-muted">
                  Intent: {agentData.intent}
                </span>
              ) : null}
              {agentData?.action ? (
                <span className="rounded-full border border-auto-border bg-auto-panel px-2.5 py-1 text-[11px] text-auto-muted">
                  Acción: {agentData.action}
                </span>
              ) : null}
              <span className="rounded-full border border-auto-border bg-auto-panel px-2.5 py-1 text-[11px] text-auto-muted">
                Lead {leadTemp} · {leadScore}
              </span>
              {agentData?.confidence !== null && agentData?.confidence !== undefined ? (
                <span className="rounded-full border border-auto-border bg-auto-panel px-2.5 py-1 text-[11px] text-auto-muted">
                  Confianza: {Math.round(Number(agentData.confidence || 0) * 100)}%
                </span>
              ) : null}
              {agentData?.handoffRecommended ? (
                <span className="rounded-full border border-auto-border bg-auto-panel px-2.5 py-1 text-[11px] font-medium text-auto-text">
                  Recomienda humano
                </span>
              ) : null}
            </div>

            {agentData?.suggestedReply ? (
              <div className="mt-3 rounded-auto-lg border border-auto-border bg-auto-panel p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-auto-muted">Respuesta sugerida</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-auto-text">{agentData.suggestedReply}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => prefill(agentData.suggestedReply)}
                    className="rounded-auto-lg border border-auto-border bg-auto-surface px-3 py-1.5 text-xs font-medium text-auto-text hover:bg-auto-panel2"
                  >
                    Usar sugerencia
                  </button>
                  <button
                    type="button"
                    disabled={feedbackLoading}
                    onClick={() => submitAgentFeedback("approved")}
                    className="rounded-auto-lg border border-auto-border bg-auto-surface px-3 py-1.5 text-xs font-medium text-auto-text hover:bg-auto-panel2 disabled:opacity-50"
                  >
                    👍 Correcta
                  </button>
                  <button
                    type="button"
                    disabled={feedbackLoading}
                    onClick={() => submitAgentFeedback("rejected")}
                    className="rounded-auto-lg border border-auto-border bg-auto-surface px-3 py-1.5 text-xs font-medium text-auto-text hover:bg-auto-panel2 disabled:opacity-50"
                  >
                    👎 No sirve
                  </button>
                  {agentData?.handoffRecommended ? (
                    <button
                      type="button"
                      disabled={feedbackLoading}
                      onClick={() => submitAgentFeedback("handoff")}
                      className="rounded-auto-lg border border-auto-border bg-auto-surface px-3 py-1.5 text-xs font-medium text-auto-text hover:bg-auto-panel2 disabled:opacity-50"
                    >
                      Derivar a humano
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 text-[11px] text-auto-muted">
                  Este feedback se guarda para mejorar el agente con ejemplos reales del equipo.
                </div>
              </div>
            ) : null}

            {(agentData?.missingFields?.length || agentData?.internalReason) ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {agentData?.missingFields?.length ? (
                  <div className="rounded-auto-lg border border-auto-border bg-auto-panel p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-auto-muted">Datos faltantes</div>
                    <div className="mt-1 text-sm text-auto-text">{agentData.missingFields.join(', ')}</div>
                  </div>
                ) : null}
                {agentData?.internalReason ? (
                  <div className="rounded-auto-lg border border-auto-border bg-auto-panel p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-auto-muted">Motivo interno</div>
                    <div className="mt-1 text-sm text-auto-text">{agentData.internalReason}</div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-auto-surface">
        <MessagesList ticketId={ticketId} isGroup={ticket?.isGroup} />
      </div>

      <div className="shrink-0">
        <ImprovedMessageInput ticketStatus={ticket?.status} />
      </div>
    </div>
  );
}
