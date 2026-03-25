import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import toastError from "../errors/toastError";

const STAGES = [
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
    <div className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-2">
      {children}
    </div>
  );
}

function Card({ children, className = "" }) {
  return (
    <div className={`bg-auto-panel2 border border-auto-border rounded-auto-lg p-3 ${className}`}>
      {children}
    </div>
  );
}

export default function LeadPanelAutos({ ticketId }) {
  const [loading, setLoading]     = useState(true);
  const [ticket, setTicket]       = useState(null);
  const [tags, setTags]           = useState([]);
  const [notes, setNotes]         = useState([]);
  const [tagInput, setTagInput]   = useState("");
  const [noteInput, setNoteInput] = useState("");

  const stage    = useMemo(() => parseKvpTag(tags, "stage"),    [tags]);
  const interest = useMemo(() => parseKvpTag(tags, "interest"), [tags]);

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

    const run = async () => {
      try {
        const [tRes, tagsRes, notesRes] = await Promise.all([
          api.get(`/tickets/${ticketId}`),
          api.get(`/tickets/${ticketId}/tags`),
          api.get(`/tickets/${ticketId}/notes`),
        ]);
        if (!mounted) return;
        setTicket(tRes.data || null);
        setTags(tagsRes.data?.tags || []);
        setNotes(notesRes.data?.notes || []);
      } catch (err) {
        toastError(err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    run();
    return () => { mounted = false; };
  }, [ticketId]);

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

  const setStage    = (v) => saveTags(upsertKvpTag(tags, "stage", v));
  const setInterest = (v) => saveTags(upsertKvpTag(tags, "interest", v));

  const contact = ticket?.contact;
  const phone   = contact?.number ? String(contact.number) : "";
  const waLink  = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : "";
  const initials = (contact?.name || "?").trim().slice(0, 2).toUpperCase();

  return (
    <div className="flex h-full flex-col bg-auto-panel border-l border-auto-border">
      {/* Header */}
      <div className="border-b border-auto-border px-4 py-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-auto-text">Ficha del lead</div>
          <div className="text-[11px] text-white/30 mt-0.5">Info comercial</div>
        </div>
        {contact?.leadSource && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-auto-accent/10 border border-auto-accent/20 text-auto-accent uppercase">
            {String(contact.leadSource)}
          </span>
        )}
      </div>

      {loading ? (
        <div className="p-3 flex flex-col gap-2">
          {[80, 110, 150].map((h, i) => (
            <div key={i} className="animate-pulse rounded-auto-lg bg-auto-panel2" style={{ height: h }} />
          ))}
        </div>
      ) : !ticket ? (
        <div className="p-4 text-sm text-white/30">No se pudo cargar la ficha.</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col gap-2 scrollbar-thin scrollbar-thumb-auto-border">

          {/* Contacto */}
          <Card>
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
          <Card>
            <SectionLabel>Estado comercial</SectionLabel>
            <div className="flex gap-2 mb-2">
              {stage && (
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${STAGE_COLOR[stage] || "text-white/40 bg-white/[0.04] border-white/10"}`}>
                  {STAGES.find(s => s.value === stage)?.label || stage}
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
                  {STAGES.map(s => (
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

          {/* Notas */}
          <Card>
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
