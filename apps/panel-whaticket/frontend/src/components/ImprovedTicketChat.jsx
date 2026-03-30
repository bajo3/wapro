import React, { useMemo, useState, useContext } from "react";
import clsx from "clsx";
import { toast } from "react-toastify";
import {
  Calculator,
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

import api from "../services/api";
import toastError from "../errors/toastError";
import { AuthContext } from "../context/Auth/AuthContext";
import MessagesList from "./MessagesList";
import ImprovedMessageInput from "./ImprovedMessageInput";
import CreditCalculator from "./CreditCalculator";

const statusLabelMap = {
  pending: "En cola",
  open: "Trabajando",
  closed: "Cerrado",
};

const actionButtonBase =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-auto-lg border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-text transition-colors hover:bg-auto-panel2";

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
  const { user } = useContext(AuthContext);

  const [showQuickReplies, setShowQuickReplies] = useState(true);
  const [showCreditCalc, setShowCreditCalc] = useState(false);
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

  const handleChangeStatus = async (nextStatus) => {
    try {
      const trimmed = String(nextStatus || "").toLowerCase();
      if (!ticket?.id) return;

      const nextUserId = trimmed === "open" || trimmed === "closed" ? user?.id || null : null;
      await api.put(`/tickets/${ticket.id}`, {
        status: trimmed,
        userId: nextUserId,
      });

      if (trimmed !== "open") {
        history.push("/tickets");
      }
    } catch (err) {
      toastError(err);
    }
  };

  const QUICK_REPLIES = useMemo(
    () => [
      { label: "Hola 👋", text: "Hola 👋 ¿cómo estás?" },
      { label: "Opciones", text: "¿Te paso opciones disponibles y formas de pago?" },
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
        finalReply: verdict === "edited" ? null : agentData?.suggestedReply || null,
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
      {/* ── Header: fila 1 = info del contacto, fila 2 = barra de acciones con scroll ── */}
      <div className="shrink-0 border-b border-auto-border bg-auto-panel">
        {/* Fila 1: avatar + nombre + estado + teléfono */}
        <div className="flex min-w-0 items-center gap-2 px-3 pt-2 pb-1.5 md:px-4">
          {/* Botón volver (mobile) */}
          <button
            type="button"
            onClick={() => history.push("/tickets")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-auto-lg border border-auto-border bg-auto-surface text-auto-text hover:bg-auto-panel2 xl:hidden"
            title="Volver a la lista"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Avatar */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-auto-border bg-auto-accent/10 text-auto-accent">
            <UserRound className="h-3.5 w-3.5" />
          </div>

          {/* Info del contacto */}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-auto-text">
                {loading ? "Cargando…" : displayName}
              </span>
              <span
                className={clsx(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  statusKey === "open"
                    ? "border-emerald-500/25 bg-emerald-500/12 text-emerald-400"
                    : statusKey === "pending"
                    ? "border-amber-500/25 bg-amber-500/12 text-amber-400"
                    : "border-auto-border bg-auto-surface text-auto-muted"
                )}
              >
                {statusLabel}
              </span>
              {isHumanOnly ? (
                <span className="shrink-0 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                  HUMANO
                </span>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-x-2 text-[11px] text-auto-muted">
              {phone ? <span className="shrink-0 font-mono tracking-tight">{phone}</span> : null}
              {assignedTo ? (
                <>
                  <span className="text-auto-border">·</span>
                  <span className="truncate">{assignedTo}</span>
                </>
              ) : null}
              {ticket?.id ? <span className="hidden shrink-0 xl:inline text-auto-border">#{ticket.id}</span> : null}
            </div>
          </div>
        </div>

        {/* Fila 2: barra de acciones — scroll horizontal completo */}
        <div className="w-full overflow-x-auto border-t border-auto-border/50 px-2 py-1 md:px-3">
          <div className="flex w-max items-center gap-1">
            {waLink ? (
              <a
                className={actionButtonBase}
                href={waLink}
                target="_blank"
                rel="noreferrer"
                title="Abrir en WhatsApp"
              >
                <PhoneCall className="h-3.5 w-3.5" />
                <span>WA</span>
              </a>
            ) : null}

            <button
              type="button"
              onClick={() => onOpenContact?.(1)}
              className={actionButtonBase}
              title="Gestión del lead"
            >
              <Info className="h-3.5 w-3.5" />
              <span>Gestión</span>
            </button>

            <button
              type="button"
              onClick={() => history.push("/quotations")}
              className={actionButtonBase}
              title="Ir a cotizaciones"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Cotizar</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenContact?.(1)}
              className={actionButtonBase}
              title="Programar recontacto"
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>Recontacto</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowCreditCalc((v) => !v);
                if (!showCreditCalc) setShowQuickReplies(false);
              }}
              className={clsx(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-auto-lg border px-3 text-xs font-medium transition-colors",
                showCreditCalc
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                  : "border-auto-border bg-auto-surface text-auto-text hover:bg-auto-panel2"
              )}
              title="Calcular crédito automotor"
            >
              <Calculator className="h-3.5 w-3.5" />
              <span>Crédito</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowQuickReplies((value) => !value);
                if (!showQuickReplies) setShowCreditCalc(false);
              }}
              className={clsx(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-auto-lg border px-3 text-xs font-medium transition-colors",
                showQuickReplies
                  ? "border-auto-accent/30 bg-auto-accent/15 text-auto-accent"
                  : "border-auto-border bg-auto-surface text-auto-text hover:bg-auto-panel2"
              )}
              title="Mensajes rápidos"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Rápidos</span>
            </button>

            {ticket?.id ? (
              <select
                value={statusKey}
                onChange={(event) => handleChangeStatus(event.target.value)}
                className="inline-flex h-9 shrink-0 items-center rounded-auto-lg border border-auto-border bg-auto-surface px-2 text-xs font-medium text-auto-text outline-none transition-colors hover:bg-auto-panel2 focus:border-auto-accent/40"
                title="Cambiar estado del ticket"
              >
                <option value="pending">En cola</option>
                <option value="open">Trabajando</option>
                <option value="closed">Cerrado</option>
              </select>
            ) : null}

            <span className="mx-0.5 h-4 w-px shrink-0 bg-auto-border" aria-hidden="true" />

            <select
              value={botMode}
              onChange={async (e) => {
                const next = e.target.value;
                try {
                  await api.put(`/tickets/${ticket.id}/bot-mode`, { botMode: next });
                } catch (err) {
                  toastError(err);
                }
              }}
              className={clsx(
                "inline-flex h-9 shrink-0 cursor-pointer items-center rounded-auto-lg border px-2 text-[11px] font-medium outline-none transition-colors",
                isHumanOnly
                  ? "border-blue-500/20 bg-blue-500/10 text-blue-400"
                  : botMode === "OFF"
                    ? "border-red-500/20 bg-red-500/10 text-red-400"
                    : "border-auto-border bg-auto-surface text-auto-hint hover:bg-auto-panel2"
              )}
              title="Cambiar modo del bot"
            >
              <option value="ON">Bot: Auto</option>
              <option value="HUMAN_ONLY">Bot: Humano</option>
              <option value="OFF">Bot: Off</option>
            </select>

            <button
              type="button"
              onClick={() => history.replace(`/tickets/${ticketId}`)}
              className={clsx(actionButtonBase, "px-2")}
              title="Refrescar chat"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => onToggleView?.()}
              className={clsx(actionButtonBase, "px-2 text-auto-hint")}
              title="Cambiar a vista clásica"
            >
              <MessageSquareText className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {showCreditCalc ? (
        <div className="shrink-0 border-b border-auto-border bg-auto-panel px-3 py-3 md:px-4">
          <CreditCalculator />
        </div>
      ) : null}

      {showQuickReplies && !showCreditCalc ? (
        <div className="shrink-0 border-b border-auto-border bg-auto-panel px-3 py-1.5 md:px-4">
          <div className="overflow-x-auto">
            <div className="flex w-max items-center gap-1.5 py-0.5">
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-auto-hint">Rápidos:</span>
              {QUICK_REPLIES.map((quickReply) => (
                <button
                  key={quickReply.label}
                  type="button"
                  onClick={() => prefill(quickReply.text)}
                  className="shrink-0 rounded-full border border-auto-border bg-auto-surface px-2.5 py-1 text-[11px] text-auto-text transition-colors hover:border-auto-accent/30 hover:bg-auto-accent/10 hover:text-auto-accent"
                >
                  {quickReply.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

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
                    className={actionButtonBase}
                  >
                    Usar sugerencia
                  </button>
                  <button
                    type="button"
                    disabled={feedbackLoading}
                    onClick={() => submitAgentFeedback("approved")}
                    className={`${actionButtonBase} disabled:opacity-50`}
                  >
                    👍 Correcta
                  </button>
                  <button
                    type="button"
                    disabled={feedbackLoading}
                    onClick={() => submitAgentFeedback("rejected")}
                    className={`${actionButtonBase} disabled:opacity-50`}
                  >
                    👎 No sirve
                  </button>
                  {agentData?.handoffRecommended ? (
                    <button
                      type="button"
                      disabled={feedbackLoading}
                      onClick={() => submitAgentFeedback("handoff")}
                      className={`${actionButtonBase} disabled:opacity-50`}
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

            {agentData?.missingFields?.length || agentData?.internalReason ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {agentData?.missingFields?.length ? (
                  <div className="rounded-auto-lg border border-auto-border bg-auto-panel p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-auto-muted">Datos faltantes</div>
                    <div className="mt-1 text-sm text-auto-text">{agentData.missingFields.join(", ")}</div>
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

            {/* Contexto extraído del lead — lo que aprendió el bot */}
            {agentData?.extracted && Object.keys(agentData.extracted).length > 0 ? (
              <div className="mt-3 rounded-auto-lg border border-auto-border bg-auto-panel p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-auto-muted mb-2">Contexto del lead</div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    agentData.extracted.brand && `Marca: ${agentData.extracted.brand}`,
                    agentData.extracted.model && `Modelo: ${agentData.extracted.model}`,
                    (agentData.extracted.maxPrice || agentData.extracted.amount) &&
                      `Presupuesto: ${agentData.extracted.currency ?? "ARS"} ${Number(agentData.extracted.maxPrice || agentData.extracted.amount || 0).toLocaleString("es-AR")}`,
                    agentData.extracted.condition && `Condición: ${agentData.extracted.condition === "nuevo" ? "0km" : "Usado"}`,
                    agentData.extracted.transmission && `Caja: ${agentData.extracted.transmission}`,
                    agentData.extracted.fuel && `Combustible: ${agentData.extracted.fuel}`,
                    agentData.extracted.year && `Año: ${agentData.extracted.year}`,
                    agentData.extracted.hasTradeIn && "Tiene permuta",
                    agentData.extracted.wantsFinancing && "Quiere financiación",
                    agentData.extracted.gnc !== undefined && `GNC: ${agentData.extracted.gnc ? "Sí" : "No"}`,
                    agentData.extracted.city && `Ciudad: ${agentData.extracted.city}`,
                    agentData.extracted.useCase && `Uso: ${agentData.extracted.useCase}`,
                  ].filter(Boolean).map((tag, i) => (
                    <span key={i} className="rounded-full border border-auto-border bg-auto-surface px-2.5 py-1 text-[11px] text-auto-text">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <MessagesList ticketId={ticketId} isGroup={ticket?.isGroup} />
      </div>

      <div className="shrink-0">
        <ImprovedMessageInput ticketStatus={ticket?.status} />
      </div>
    </div>
  );
}
