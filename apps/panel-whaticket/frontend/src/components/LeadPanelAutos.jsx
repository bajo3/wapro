import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import toastError from "../errors/toastError";

const Badge = ({ children }) => (
  <span className="inline-flex items-center rounded-full border border-auto-border bg-auto-panel2 px-2 py-0.5 text-[11px] text-auto-text">
    {children}
  </span>
);

const SectionTitle = ({ children }) => (
  <div className="text-xs font-semibold uppercase tracking-wide text-auto-muted">
    {children}
  </div>
);

const parseKvpTag = (tags, key) => {
  const prefix = `${key}:`;
  const found = (tags || []).find((t) => String(t).toLowerCase().startsWith(prefix));
  if (!found) return "";
  return String(found).slice(prefix.length).trim();
};

const upsertKvpTag = (tags, key, value) => {
  const prefix = `${key}:`;
  const cleaned = (tags || []).filter(
    (t) => !String(t).toLowerCase().startsWith(prefix)
  );
  if (!value) return cleaned;
  return Array.from(new Set([...cleaned, `${key}:${value}`]));
};

export default function LeadPanelAutos({ ticketId }) {
  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState(null);
  const [tags, setTags] = useState([]);
  const [notes, setNotes] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const stage = useMemo(() => parseKvpTag(tags, "stage"), [tags]);
  const interest = useMemo(() => parseKvpTag(tags, "interest"), [tags]);

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
          api.get(`/tickets/${ticketId}/notes`)
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
    return () => {
      mounted = false;
    };
  }, [ticketId]);

  const saveTags = async (nextTags) => {
    try {
      const { data } = await api.put(`/tickets/${ticketId}/tags`, { tags: nextTags });
      setTags(data?.tags || nextTags);
    } catch (err) {
      toastError(err);
    }
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
    } catch (err) {
      toastError(err);
    }
  };

  const deleteNote = async (noteId) => {
    try {
      await api.delete(`/tickets/${ticketId}/notes/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      toastError(err);
    }
  };

  const setStage = async (value) => {
    const next = upsertKvpTag(tags, "stage", value);
    await saveTags(next);
  };

  const setInterest = async (value) => {
    const next = upsertKvpTag(tags, "interest", value);
    await saveTags(next);
  };

  const contact = ticket?.contact;
  const phone = contact?.number ? String(contact.number) : "";
  const waLink = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : "";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-auto-border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-auto-text">Ficha</div>
            <div className="mt-0.5 text-xs text-auto-muted">Lead / Auto</div>
          </div>
          {contact?.leadSource ? <Badge>{String(contact.leadSource)}</Badge> : null}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 p-4">
          <div className="h-16 animate-pulse rounded-auto-lg border border-auto-border bg-auto-panel2" />
          <div className="h-28 animate-pulse rounded-auto-lg border border-auto-border bg-auto-panel2" />
          <div className="h-40 animate-pulse rounded-auto-lg border border-auto-border bg-auto-panel2" />
        </div>
      ) : !ticket ? (
        <div className="p-4 text-sm text-auto-muted">No se pudo cargar la ficha.</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Contact */}
          <div className="rounded-auto-xl border border-auto-border bg-auto-panel p-3 shadow-auto-soft">
            <SectionTitle>Contacto</SectionTitle>
            <div className="mt-2 text-sm font-semibold text-auto-text">
              {contact?.name || "Sin nombre"}
            </div>
            <div className="mt-1 text-xs text-auto-muted">{phone || "Sin número"}</div>

            <div className="mt-3 flex flex-wrap gap-2">
              {waLink ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                  className="h-9 rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text hover:bg-auto-panel2"
                >
                  Abrir WhatsApp
                </a>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  if (!phone) return;
                  navigator.clipboard?.writeText(phone);
                }}
                className="h-9 rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text hover:bg-auto-panel2"
              >
                Copiar
              </button>
            </div>
          </div>

          {/* Commercial */}
          <div className="mt-3 rounded-auto-xl border border-auto-border bg-auto-panel p-3 shadow-auto-soft">
            <SectionTitle>Estado comercial</SectionTitle>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-auto-muted">
                Etapa
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="mt-1 h-10 w-full rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text outline-none focus:ring-2 focus:ring-auto-accent/40"
                >
                  <option value="">Sin definir</option>
                  <option value="new">Nuevo</option>
                  <option value="qualified">Calificado</option>
                  <option value="quote">Presupuesto</option>
                  <option value="negotiation">Negociación</option>
                  <option value="won">Cerrado (Ganado)</option>
                  <option value="lost">Cerrado (Perdido)</option>
                </select>
              </label>

              <label className="text-xs text-auto-muted">
                Interés
                <select
                  value={interest}
                  onChange={(e) => setInterest(e.target.value)}
                  className="mt-1 h-10 w-full rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text outline-none focus:ring-2 focus:ring-auto-accent/40"
                >
                  <option value="">Sin definir</option>
                  <option value="low">Bajo</option>
                  <option value="medium">Medio</option>
                  <option value="high">Alto</option>
                </select>
              </label>
            </div>

            <div className="mt-3 text-xs text-auto-muted">
              * Se guarda como tags: <span className="font-mono">stage:*</span> y <span className="font-mono">interest:*</span>
            </div>
          </div>

          {/* Tags */}
          <div className="mt-3 rounded-auto-xl border border-auto-border bg-auto-panel p-3 shadow-auto-soft">
            <SectionTitle>Tags</SectionTitle>
            <div className="mt-2 flex gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Ej: suv, contado, toma-usado"
                className="h-10 flex-1 rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text outline-none placeholder:text-auto-muted focus:ring-2 focus:ring-auto-accent/40"
              />
              <button
                type="button"
                onClick={addTag}
                className="h-10 rounded-auto-md bg-auto-accent px-3 text-sm font-medium text-white hover:opacity-95"
              >
                Agregar
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {tags.length === 0 ? (
                <div className="text-sm text-auto-muted">Sin tags.</div>
              ) : (
                tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => removeTag(t)}
                    className="group inline-flex items-center gap-2 rounded-full border border-auto-border bg-auto-panel2 px-3 py-1 text-xs text-auto-text hover:bg-auto-panel"
                    title="Quitar"
                  >
                    <span>{t}</span>
                    <span className="text-auto-muted group-hover:text-auto-text">×</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="mt-3 rounded-auto-xl border border-auto-border bg-auto-panel p-3 shadow-auto-soft">
            <SectionTitle>Notas</SectionTitle>
            <div className="mt-2 flex gap-2">
              <input
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Nota interna (no se envía al cliente)…"
                className="h-10 flex-1 rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text outline-none placeholder:text-auto-muted focus:ring-2 focus:ring-auto-accent/40"
              />
              <button
                type="button"
                onClick={addNote}
                className="h-10 rounded-auto-md bg-auto-accent px-3 text-sm font-medium text-white hover:opacity-95"
              >
                Guardar
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {notes.length === 0 ? (
                <div className="text-sm text-auto-muted">Sin notas.</div>
              ) : (
                notes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-auto-lg border border-auto-border bg-auto-panel2 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm text-auto-text">{n.body}</div>
                      <button
                        type="button"
                        onClick={() => deleteNote(n.id)}
                        className="text-xs text-auto-muted hover:text-auto-text"
                      >
                        Eliminar
                      </button>
                    </div>
                    {n.createdAt ? (
                      <div className="mt-2 text-[11px] text-auto-muted">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
