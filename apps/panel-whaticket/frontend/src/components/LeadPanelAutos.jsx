import React, { useEffect, useMemo, useRef, useState } from "react";
import { useHistory } from "react-router-dom";
import { toast } from "react-toastify";
import api from "../services/api";
import toastError from "../errors/toastError";

// STAGES are now loaded dynamically from GET /pipeline/stages.
// This fallback is only used if the request fails before any data arrives.
const STAGES_FALLBACK = [
  { value: "",            label: "Sin definir" },
  { value: "new",         label: "Nuevo" },
  { value: "qualified",   label: "Calificado" },
  { value: "quote",       label: "Presupuesto" },
  { value: "negotiation", label: "Negociación" },
  { value: "won",         label: "Ganado ✓" },
  { value: "lost",        label: "Perdido ✗" },
];

const INTERESTS = [
  { value: "",       label: "Sin definir" },
  { value: "low",    label: "Bajo" },
  { value: "medium", label: "Medio" },
  { value: "high",   label: "Alto" },
];

const INTEREST_COLOR = {
  high:   "text-green-400 bg-green-500/10 border-green-500/20",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  low:    "text-white/40 bg-white/[0.04] border-white/10",
};

const STAGE_COLOR = {
  won:         "text-green-400 bg-green-500/10 border-green-500/20",
  lost:        "text-red-400 bg-red-500/10 border-red-500/20",
  negotiation: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  quote:       "text-blue-400 bg-blue-500/10 border-blue-500/20",
  qualified:   "text-purple-400 bg-purple-500/10 border-purple-500/20",
  new:         "text-white/50 bg-white/[0.04] border-white/10",
};

const parseKvpTag = (tags, key) => {
  const prefix = `${key}:`;
  const found = (tags || []).find((t) => String(t).toLowerCase().startsWith(prefix));
  if (!found) return "";
  return String(found).slice(prefix.length).trim();
};

const upsertKvpTag = (tags, key, value) => {
  const prefix = `${key}:`;
  const cleaned = (tags || []).filter((t) => !String(t).toLowerCase().startsWith(prefix));
  if (!value) return cleaned;
  return Array.from(new Set([...cleaned, `${key}:${value}`]));
};

function SectionLabel({ children }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35 mb-2.5">
      {children}
    </div>
  );
}

const Card = React.forwardRef(({ children, className = "" }, ref) => {
  return (
    <div ref={ref} className={`bg-auto-panel2 border border-auto-border rounded-auto-lg p-3.5 ${className}`}>
      {children}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Hook: fetch pipeline stages once, shared across renders
// ---------------------------------------------------------------------------
function usePipelineStages() {
  const [stages, setStages] = useState(STAGES_FALLBACK);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    api
      .get("/pipeline/stages")
      .then(({ data }) => {
        // Normalise: backend returns [{ id, name, ... }]
        // Map to { value: id (as string), label: name } plus a blank "sin definir" entry
        const list = Array.isArray(data) ? data : data?.stages || [];
        if (list.length === 0) return;
        const mapped = [
          { value: "", label: "Sin definir" },
          ...list.map((s) => ({ value: String(s.id), label: s.name, _id: s.id })),
        ];
        setStages(mapped);
      })
      .catch(() => {
        // Keep the static fallback silently — not critical
      });
  }, []);

  return stages;
}

export default function LeadPanelAutos({ ticketId, initialSection = "commercial", focusNonce = 0 }) {
  const dynamicStages = usePipelineStages();
  const history = useHistory();

  const [loading, setLoading]     = useState(true);
  const [ticket, setTicket]       = useState(null);
  const [tags, setTags]           = useState([]);
  const [notes, setNotes]         = useState([]);
  const [tagInput, setTagInput]   = useState("");
  const [noteInput, setNoteInput] = useState("");

  // Cotizaciones vinculadas a este ticket
  const [quotations, setQuotations]         = useState([]);
  const [quotationsLoading, setQuotationsLoading] = useState(false);
  const [scheduledRows, setScheduledRows] = useState([]);
  const [recontactAt, setRecontactAt] = useState("");
  const [recontactDays, setRecontactDays] = useState(3);
  const [recontactBody, setRecontactBody] = useState("Hola! ¿Cómo venimos? Si querés, decime presupuesto y qué estás buscando y te paso opciones disponibles 😊");
  const [conversationBusy, setConversationBusy] = useState(false);

  const stage    = useMemo(() => parseKvpTag(tags, "stage"),    [tags]);
  const interest = useMemo(() => parseKvpTag(tags, "interest"), [tags]);
  const sectionRefs = useRef({});

  // visible tags = excluir los kvp internos
  const visibleTags = useMemo(
    () => tags.filter((t) => !String(t).startsWith("stage:") && !String(t).startsWith("interest:")),
    [tags]
  );

  useEffect(() => {
    let mounted = true;
    if (!ticketId) return;
    setLoading(true);
    setTicket(null);
    setTags([]);
    setNotes([]);
    setScheduledRows([]);

    const run = async () => {
      try {
        const [tRes, tagsRes, notesRes, scheduledRes] = await Promise.all([
          api.get(`/tickets/${ticketId}`),
          api.get(`/tickets/${ticketId}/tags`),
          api.get(`/tickets/${ticketId}/notes`),
          api.get(`/scheduled-messages`, { params: { ticketId, limit: 25 } }),
        ]);
        if (!mounted) return;
        setTicket(tRes.data || null);
        setTags(tagsRes.data?.tags || []);
        setNotes(notesRes.data?.notes || []);
        setScheduledRows(scheduledRes.data?.rows || []);
      } catch (err) {
        toastError(err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    run();
    return () => { mounted = false; };
  }, [ticketId]);

  // Fetch cotizaciones del ticket
  useEffect(() => {
    let mounted = true;
    if (!ticketId) return;
    setQuotations([]);
    setQuotationsLoading(true);
    api
      .get("/quotations", { params: { ticketId } })
      .then(({ data }) => {
        if (!mounted) return;
        const list = Array.isArray(data) ? data : data?.quotations || data?.rows || [];
        setQuotations(list);
      })
      .catch(() => {
        // best-effort: no toast para no sobrecargar si el endpoint no existe aún
        if (mounted) setQuotations([]);
      })
      .finally(() => { if (mounted) setQuotationsLoading(false); });
    return () => { mounted = false; };
  }, [ticketId]);

  const goToNewQuotation = () => {
    if (!ticketId) return;
    const contact = ticket?.contact;
    const params = new URLSearchParams();
    params.set("ticketId", ticketId);
    if (contact?.id) params.set("contactId", contact.id);
    if (contact?.name) params.set("contactName", encodeURIComponent(contact.name));
    // Intentar pre-completar datos del bot desde los tags (best-effort)
    const botVehicle = parseKvpTag(tags, "vehicle") || parseKvpTag(tags, "vehiculo");
    const botBudget  = parseKvpTag(tags, "budget")  || parseKvpTag(tags, "presupuesto");
    if (botVehicle) params.set("vehicleLabel", encodeURIComponent(botVehicle));
    if (botBudget)  params.set("price", botBudget.replace(/\D/g, ""));
    history.push(`/quotations?${params.toString()}`);
  };

  const saveTags = async (nextTags) => {
    try {
      const { data } = await api.put(`/tickets/${ticketId}/tags`, { tags: nextTags });
      setTags(data?.tags || nextTags);
    } catch (err) { toastError(err); }
  };

  const addTag = async () => {
    const v = String(tagInput || "").trim();
    if (!v) return;
    setTagInput("");
    await saveTags(Array.from(new Set([...tags, v])));
  };

  const removeTag = async (t) => {
    await saveTags(tags.filter((x) => x !== t));
  };

  const addNote = async () => {
    const body = String(noteInput || "").trim();
    if (!body) return;
    setNoteInput("");
    try {
      const { data } = await api.post(`/tickets/${ticketId}/notes`, { body });
      setNotes((prev) => [data, ...prev]);
    } catch (err) { toastError(err); }
  };

  const deleteNote = async (noteId) => {
    try {
      await api.delete(`/tickets/${ticketId}/notes/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) { toastError(err); }
  };

  // Set stage: update kvp tag AND, if the new value maps to a pipeline stage id,
  // call PATCH /pipeline/tickets/:ticketId/stage for the board to stay in sync.
  const setStage = async (v) => {
    // Optimistic local update first
    const nextTags = upsertKvpTag(tags, "stage", v);
    setTags(nextTags);

    // Persist tags (fire-and-forget, errors toasted inside saveTags)
    saveTags(nextTags);

    // Sync to pipeline board if value looks like a numeric id (dynamic stages)
    // or is a known slug (static fallback). We attempt the pipeline call in both
    // cases; the backend decides whether to accept it.
    if (ticketId && v) {
      // Find the matching dynamic stage to get its numeric id
      const matched = dynamicStages.find(
        (s) => s.value === v || (s._id !== undefined && String(s._id) === String(v))
      );
      const toStageId = matched?._id ?? (Number.isFinite(Number(v)) ? Number(v) : null);
      if (toStageId) {
        try {
          await api.patch(`/pipeline/tickets/${ticketId}/stage`, { toStageId });
        } catch (err) {
          toastError(err);
          // Do not roll back the tag — the tag is the source of truth in LeadPanel
        }
      }
    }
  };

  const setInterest = (v) => saveTags(upsertKvpTag(tags, "interest", v));

  const refreshScheduled = async () => {
    if (!ticketId) return;
    try {
      const { data } = await api.get(`/scheduled-messages`, { params: { ticketId, limit: 25 } });
      setScheduledRows(data?.rows || []);
    } catch (err) {
      toastError(err);
    }
  };

  const createRecontact = async () => {
    if (!ticketId || !ticket?.contact?.id) return;

    const body = String(recontactBody || "").trim();
    const days = Math.max(0, Number(recontactDays) || 0);

    if (!body) return;

    let sendAt = recontactAt ? new Date(recontactAt).toISOString() : null;
    if (!sendAt) {
      sendAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    try {
      await api.post(`/scheduled-messages`, {
        ticketId,
        contactId: ticket.contact.id,
        body,
        sendAt
      });
      setRecontactAt("");
      toast.success("Recontacto agendado");
      await refreshScheduled();
    } catch (err) {
      toastError(err);
    }
  };

  const cancelScheduled = async (id) => {
    try {
      await api.post(`/scheduled-messages/${id}/cancel`);
      toast.success("Recontacto cancelado");
      await refreshScheduled();
    } catch (err) {
      toastError(err);
    }
  };

  const clearConversation = async () => {
    if (!ticketId || conversationBusy) return;
    const ok = window.confirm("Se borrarán los mensajes guardados en este ticket. El contacto y el ticket seguirán existiendo. ¿Continuar?");
    if (!ok) return;

    setConversationBusy(true);
    try {
      const { data } = await api.delete(`/tickets/${ticketId}/conversation`);
      const nextTicket = data?.ticket || {};
      setTicket((prev) => ({ ...(prev || {}), ...nextTicket }));
      toast.success(`Conversación limpiada (${Number(data?.deletedCount || 0)} mensajes)`);
    } catch (err) {
      toastError(err);
    } finally {
      setConversationBusy(false);
    }
  };

  useEffect(() => {
    if (loading || !initialSection) return;
    const node = sectionRefs.current?.[initialSection];
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [initialSection, focusNonce, loading]);

  const contact = ticket?.contact;
  const phone   = contact?.number ? String(contact.number) : "";
  const waLink  = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : "";
  const initials = (contact?.name || "?").trim().slice(0, 2).toUpperCase();

  return (
    <div className="flex h-full flex-col bg-auto-panel border-l border-auto-border">
      {/* Header */}
      <div className="border-b border-auto-border px-4 py-3 flex items-center justify-between gap-2 shrink-0">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-auto-muted">Lead</div>
          <div className="mt-0.5 text-[13px] font-semibold text-auto-text">Ficha comercial</div>
        </div>
        <div className="flex items-center gap-2">
          {contact?.leadSource && (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-auto-accent/10 border border-auto-accent/25 text-auto-accent uppercase tracking-wide">
              {String(contact.leadSource)}
            </span>
          )}
          {ticket && (
            <button
              type="button"
              onClick={goToNewQuotation}
              className="h-7 px-2.5 flex items-center gap-1 rounded-auto-md bg-auto-accent text-black text-[11px] font-bold hover:bg-auto-accent2 transition-colors"
              title="Crear cotización para este ticket"
            >
              <span className="text-sm leading-none">+</span>
              Cotizar
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-4 flex flex-col gap-3">
          {[72, 120, 96, 140].map((h, i) => (
            <div key={i} className="animate-pulse rounded-auto-lg bg-auto-panel2" style={{ height: h }} />
          ))}
        </div>
      ) : !ticket ? (
        <div className="flex flex-col items-center justify-center p-8 text-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-auto-border bg-auto-panel2">
            <span className="text-auto-hint text-base">!</span>
          </div>
          <div className="text-sm font-medium text-auto-muted">No se pudo cargar la ficha</div>
          <div className="text-xs text-white/25">Reintentá abriendo el ticket nuevamente.</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col gap-2 scrollbar-thin scrollbar-thumb-auto-border">

          {/* Contacto */}
          <Card className="scroll-mt-3" ref={(node) => { sectionRefs.current.contact = node; }}>
            <SectionLabel>Contacto</SectionLabel>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-auto-accent/10 border border-auto-accent/20 flex items-center justify-center text-[13px] font-bold text-auto-accent flex-shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-auto-text truncate">
                  {contact?.name || "Sin nombre"}
                </div>
                <div className="text-[12px] text-white/40 mt-0.5 font-mono">{phone || "Sin número"}</div>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              {waLink && (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 h-8 flex items-center justify-center rounded-auto-md bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium hover:bg-green-500/15 transition-colors"
                >
                  WhatsApp
                </a>
              )}
              <button
                type="button"
                onClick={() => phone && navigator.clipboard?.writeText(phone)}
                className="flex-1 h-8 flex items-center justify-center rounded-auto-md bg-auto-surface border border-auto-border text-white/40 text-xs hover:text-auto-text transition-colors"
              >
                Copiar
              </button>
            </div>
          </Card>

          {/* Estado comercial */}
          <Card className="scroll-mt-3" ref={(node) => { sectionRefs.current.commercial = node; }}>
            <SectionLabel>Estado comercial</SectionLabel>
            <div className="flex gap-2 mb-2">
              {stage && (
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${STAGE_COLOR[stage] || "text-white/40 bg-white/[0.04] border-white/10"}`}>
                  {dynamicStages.find(s => s.value === stage)?.label || stage}
                </span>
              )}
              {interest && (
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${INTEREST_COLOR[interest] || ""}`}>
                  {INTERESTS.find(i => i.value === interest)?.label || interest}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-white/30 block mb-1">Etapa</label>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="h-8 w-full bg-auto-surface border border-auto-border rounded-auto-md px-2 text-[12px] text-auto-muted outline-none focus:border-auto-accent/50 transition-colors"
                >
                  {dynamicStages.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-white/30 block mb-1">Interés</label>
                <select
                  value={interest}
                  onChange={(e) => setInterest(e.target.value)}
                  className="h-8 w-full bg-auto-surface border border-auto-border rounded-auto-md px-2 text-[12px] text-auto-muted outline-none focus:border-auto-accent/50 transition-colors"
                >
                  {INTERESTS.map(i => (
                    <option key={i.value} value={i.value}>{i.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* Tags */}
          <Card>
            <SectionLabel>Tags</SectionLabel>
            <div className="flex gap-2 mb-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                placeholder="suv, contado, toma-usado..."
                className="h-8 flex-1 bg-auto-surface border border-auto-border rounded-auto-md px-2.5 text-[12px] text-auto-text placeholder-white/20 outline-none focus:border-auto-accent/50 transition-colors"
              />
              <button
                type="button"
                onClick={addTag}
                className="h-8 px-3 rounded-auto-md bg-auto-accent text-black text-xs font-bold hover:bg-auto-accent2 transition-colors"
              >
                +
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {visibleTags.length === 0 ? (
                <span className="text-[12px] text-white/20">Sin tags</span>
              ) : (
                visibleTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => removeTag(t)}
                    className="group inline-flex items-center gap-1 rounded-full border border-auto-border bg-auto-surface px-2.5 py-0.5 text-[11px] text-white/50 hover:border-red-500/30 hover:text-red-400 transition-colors"
                    title="Quitar"
                  >
                    {t}
                    <span className="opacity-40 group-hover:opacity-100">×</span>
                  </button>
                ))
              )}
            </div>
          </Card>

          {/* Cotizaciones vinculadas */}
          <Card>
            <div className="flex items-center justify-between mb-2.5">
              <SectionLabel>Cotizaciones</SectionLabel>
              <button
                type="button"
                onClick={goToNewQuotation}
                className="h-6 px-2 flex items-center gap-1 rounded-auto-md bg-auto-surface border border-auto-border text-white/40 text-[11px] hover:text-auto-text hover:border-auto-accent/40 transition-colors"
              >
                <span className="text-xs leading-none">+</span>
                Nueva
              </button>
            </div>
            {quotationsLoading ? (
              <div className="flex gap-2 items-center py-1">
                <div className="h-3 w-3 rounded-full border-2 border-auto-accent border-t-transparent animate-spin" />
                <span className="text-[11px] text-white/30">Cargando...</span>
              </div>
            ) : quotations.length === 0 ? (
              <div className="text-[12px] text-white/20">Sin cotizaciones vinculadas</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {quotations.map((q) => {
                  const STATUS_CLS = {
                    draft:    "text-white/40 bg-white/[0.04] border-white/10",
                    sent:     "text-blue-400 bg-blue-500/10 border-blue-500/20",
                    accepted: "text-green-400 bg-green-500/10 border-green-500/20",
                    rejected: "text-red-400 bg-red-500/10 border-red-500/20",
                  };
                  const STATUS_LABEL = { draft: "Borrador", sent: "Enviada", accepted: "Aceptada", rejected: "Rechazada" };
                  const status = q.status || "draft";
                  const price = q.totalPrice ?? q.basePrice ?? q.price ?? "";
                  const currency = q.currency ?? "ARS";
                  const vehicle = q.vehicleLabel ?? q.vehicle?.name ?? q.vehicle?.title ?? "";
                  return (
                    <div
                      key={q.id}
                      className="flex items-center justify-between gap-2 bg-auto-surface border border-auto-border rounded-auto-md px-2.5 py-2 hover:border-auto-accent/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono text-white/30">#{q.id}</span>
                          {vehicle && (
                            <span className="text-[12px] text-auto-text truncate">{vehicle}</span>
                          )}
                        </div>
                        {price !== "" && (
                          <div className="text-[11px] text-white/40 mt-0.5">
                            <span className="text-white/25 mr-0.5">{currency}</span>
                            {Number(price).toLocaleString("es-AR")}
                          </div>
                        )}
                      </div>
                      <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded border ${STATUS_CLS[status] || STATUS_CLS.draft}`}>
                        {STATUS_LABEL[status] || status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Recontacto */}
          <Card className="scroll-mt-3" ref={(node) => { sectionRefs.current.recontact = node; }}>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <SectionLabel>Recontacto</SectionLabel>
              <button
                type="button"
                onClick={refreshScheduled}
                className="h-6 px-2 rounded-auto-md bg-auto-surface border border-auto-border text-white/40 text-[11px] hover:text-auto-text hover:border-auto-accent/40 transition-colors"
              >
                Refrescar
              </button>
            </div>
            <div className="text-[12px] text-white/35 mb-3">Agendá un mensaje automático para este lead.</div>
            <div className="grid grid-cols-[110px_1fr] gap-2 mb-2">
              <input
                type="number"
                min="0"
                value={recontactDays}
                onChange={(e) => setRecontactDays(e.target.value)}
                className="h-8 w-full bg-auto-surface border border-auto-border rounded-auto-md px-2.5 text-[12px] text-auto-text outline-none focus:border-auto-accent/50 transition-colors"
                placeholder="Días"
              />
              <button
                type="button"
                onClick={createRecontact}
                className="h-8 px-3 rounded-auto-md bg-auto-accent text-black text-xs font-bold hover:bg-auto-accent2 transition-colors"
              >
                Agendar
              </button>
            </div>
            <input
              type="datetime-local"
              value={recontactAt}
              onChange={(e) => setRecontactAt(e.target.value)}
              className="h-8 w-full bg-auto-surface border border-auto-border rounded-auto-md px-2.5 text-[12px] text-auto-text outline-none focus:border-auto-accent/50 transition-colors mb-2"
            />
            <textarea
              value={recontactBody}
              onChange={(e) => setRecontactBody(e.target.value)}
              rows={3}
              className="w-full bg-auto-surface border border-auto-border rounded-auto-md px-2.5 py-2 text-[12px] text-auto-text placeholder-white/20 outline-none focus:border-auto-accent/50 transition-colors resize-y min-h-[88px]"
              placeholder="Mensaje de recontacto..."
            />

            <div className="mt-3 flex flex-col gap-2">
              {scheduledRows.length === 0 ? (
                <div className="text-[12px] text-white/20">No hay recontactos agendados.</div>
              ) : (
                scheduledRows.map((row) => (
                  <div key={row.id} className="bg-auto-surface border border-auto-border rounded-auto-md p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-white/30">#{row.id}</span>
                          <span className="text-[11px] font-semibold text-auto-text">{row.status}</span>
                        </div>
                        <div className="text-[11px] text-white/35 mt-1">
                          {row.sendAt ? new Date(row.sendAt).toLocaleString("es-AR") : "Sin fecha"}
                        </div>
                        <div className="text-[12px] text-white/55 mt-1 leading-relaxed">
                          {String(row.body || "").slice(0, 160)}
                          {String(row.body || "").length > 160 ? "…" : ""}
                        </div>
                      </div>
                      {row.status === "PENDING" ? (
                        <button
                          type="button"
                          onClick={() => cancelScheduled(row.id)}
                          className="h-7 px-2.5 rounded-auto-md bg-auto-surface border border-red-500/20 text-red-400 text-[11px] hover:bg-red-500/10 transition-colors flex-shrink-0"
                        >
                          Cancelar
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 border-t border-auto-border pt-3">
              <SectionLabel>Conversación</SectionLabel>
              <div className="text-[12px] text-white/30 mb-2">Borra el historial guardado en el CRM de este ticket.</div>
              <button
                type="button"
                onClick={clearConversation}
                disabled={conversationBusy}
                className="h-8 px-3 rounded-auto-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/15 transition-colors disabled:opacity-50"
              >
                {conversationBusy ? "Limpiando..." : "Limpiar conversación"}
              </button>
            </div>
          </Card>

          {/* Notas */}
          <Card className="scroll-mt-3" ref={(node) => { sectionRefs.current.notes = node; }}>
            <SectionLabel>Notas internas</SectionLabel>
            <div className="flex gap-2 mb-3">
              <input
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addNote()}
                placeholder="Nota interna (no se envía al cliente)..."
                className="h-8 flex-1 bg-auto-surface border border-auto-border rounded-auto-md px-2.5 text-[12px] text-auto-text placeholder-white/20 outline-none focus:border-auto-accent/50 transition-colors"
              />
              <button
                type="button"
                onClick={addNote}
                className="h-8 px-3 rounded-auto-md bg-auto-accent text-black text-xs font-bold hover:bg-auto-accent2 transition-colors"
              >
                +
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {notes.length === 0 ? (
                <div className="text-[12px] text-white/20">Sin notas</div>
              ) : (
                notes.map((n) => (
                  <div
                    key={n.id}
                    className="bg-auto-surface border border-auto-border rounded-auto-md p-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[12px] text-white/70 leading-relaxed flex-1">{n.body}</div>
                      <button
                        type="button"
                        onClick={() => deleteNote(n.id)}
                        className="text-white/20 hover:text-red-400 text-base leading-none flex-shrink-0 transition-colors"
                      >
                        ×
                      </button>
                    </div>
                    {n.createdAt && (
                      <div className="text-[10px] text-white/25 mt-1.5">
                        {new Date(n.createdAt).toLocaleString("es-AR")}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

        </div>
      )}
    </div>
  );
}
