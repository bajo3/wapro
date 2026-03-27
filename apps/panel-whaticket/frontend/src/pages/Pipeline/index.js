import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Columns, LayoutList, RefreshCw, AlertTriangle } from "lucide-react";
import api from "../../services/api";
import toastError from "../../errors/toastError";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_HOURS = 72;

function msAgo(dateStr) {
  if (!dateStr) return 0;
  return Date.now() - new Date(dateStr).getTime();
}

function formatAge(ms) {
  if (!ms || ms < 0) return null;
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "< 1 h";
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d`;
}

function loadPref(key, fallback) {
  try {
    const prefs = JSON.parse(localStorage.getItem("pipelinePrefs") || "{}");
    return key in prefs ? prefs[key] : fallback;
  } catch {
    return fallback;
  }
}

function savePref(key, value) {
  try {
    const prefs = JSON.parse(localStorage.getItem("pipelinePrefs") || "{}");
    localStorage.setItem("pipelinePrefs", JSON.stringify({ ...prefs, [key]: value }));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingState({ viewMode = "focus" }) {
  if (viewMode === "kanban") {
    return (
      <div className="flex gap-4 overflow-x-hidden pb-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex w-[320px] shrink-0 flex-col gap-3 rounded-[20px] border border-white/[0.06] bg-auto-panel p-3"
            style={{ maxHeight: "calc(100vh - 160px)" }}
          >
            <div className="animate-pulse rounded-lg bg-white/[0.06]" style={{ height: 44 }} />
            {[1, 2].map((j) => (
              <div key={j} className="animate-pulse rounded-2xl bg-white/[0.04]" style={{ height: 110 }} />
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-white/[0.06] bg-auto-panel"
          style={{ height: 120 }}
        />
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-10 text-center">
      <AlertTriangle className="h-8 w-8 text-red-400" />
      <div className="text-sm font-medium text-red-300">
        {message || "No se pudo cargar el pipeline"}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300 transition-colors hover:bg-red-500/15"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}

function EmptyColumn() {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.02] px-4 py-10 text-center text-sm text-white/30">
      No hay tickets en esta etapa.
    </div>
  );
}

// Move-to-stage dropdown rendered inside each ticket card.
// Shows a compact select with all stages except the current one.
function MoveButton({ ticket, stages, currentStageId, onMove, moving }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const otherStages = stages.filter((s) => s.id !== currentStageId);
  if (otherStages.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={moving}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[11px] text-white/50 transition-colors hover:border-auto-accent/30 hover:text-auto-accent disabled:opacity-40"
      >
        {moving ? "Moviendo..." : "Mover a"}
        <ChevronRight className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-xl border border-white/[0.1] bg-[#1a1a2e] shadow-lg">
          {otherStages.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onMove(ticket.id, s.id);
              }}
              className="block w-full px-3 py-2 text-left text-[12px] text-white/60 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-auto-accent/10 hover:text-auto-accent"
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Individual ticket card
function TicketCard({ ticket, stages, stageId, onMove, movingId }) {
  const contact = ticket.contact || ticket.Contact || {};
  const name = contact.name || contact.Name || "Sin nombre";
  const lastMsg = ticket.lastMessage || ticket.updatedAt;
  const updatedMs = msAgo(ticket.updatedAt);
  const stageMs = msAgo(ticket.pipelineStageUpdatedAt || ticket.updatedAt);
  const isStale = stageMs >= STALE_THRESHOLD_HOURS * 3_600_000;
  const moving = movingId === ticket.id;

  return (
    <article
      className={`rounded-2xl border bg-white/[0.03] p-4 transition-all hover:border-white/[0.14] hover:bg-white/[0.05] ${
        isStale ? "border-amber-500/20" : "border-white/[0.08]"
      } ${moving ? "opacity-50 pointer-events-none" : ""}`}
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-white">{name}</div>
          {contact.number && (
            <div className="mt-0.5 font-mono text-[11px] text-white/35">
              {contact.number}
            </div>
          )}
        </div>
        {isStale && (
          <span
            title={`Sin actividad por ${formatAge(stageMs)}`}
            className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-400"
          />
        )}
      </div>

      {/* Last message preview */}
      {lastMsg && (
        <div className="mb-3 line-clamp-2 text-[12px] leading-relaxed text-white/40">
          {typeof lastMsg === "string" && lastMsg.length < 200 ? lastMsg : "Último mensaje disponible"}
        </div>
      )}

      {/* Meta row */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {updatedMs > 0 && (
          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/35">
            {formatAge(updatedMs)} sin actividad
          </span>
        )}
        {ticket.status && (
          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/35 capitalize">
            {ticket.status}
          </span>
        )}
        {(ticket.value || ticket.quotationValue) && (
          <span className="rounded-full border border-auto-accent/20 bg-auto-accent/10 px-2 py-0.5 text-[10px] font-medium text-auto-accent">
            $ {(ticket.value || ticket.quotationValue).toLocaleString("es-AR")}
          </span>
        )}
      </div>

      {/* Actions */}
      <MoveButton
        ticket={ticket}
        stages={stages}
        currentStageId={stageId}
        onMove={onMove}
        moving={moving}
      />
    </article>
  );
}

// Single kanban column
function KanbanColumn({ stage, stages, onMove, movingId }) {
  const tickets = stage.tickets || [];
  return (
    <div className="flex w-[320px] shrink-0 flex-col rounded-[20px] border border-white/[0.08] bg-auto-panel shadow-auto-soft" style={{ maxHeight: "calc(100vh - 160px)" }}>
      {/* Column header */}
      <div className="sticky top-0 z-10 rounded-t-[20px] border-b border-white/[0.06] bg-auto-panel px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: stage.color || "#6366f1" }}
            />
            <span className="text-[13px] font-semibold text-white">{stage.name}</span>
          </div>
          <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] font-medium text-white/50">
            {tickets.length}
          </span>
        </div>
        {stage.description && (
          <div className="mt-1 text-[11px] text-white/30">{stage.description}</div>
        )}
      </div>
      {/* Tickets */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 scrollbar-thin scrollbar-thumb-auto-border">
        {tickets.length === 0 ? (
          <EmptyColumn />
        ) : (
          tickets.map((t) => (
            <TicketCard
              key={t.id}
              ticket={t}
              stages={stages}
              stageId={stage.id}
              onMove={onMove}
              movingId={movingId}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Focus view: one stage at a time, full width
function FocusView({ stages, focusIdx, setFocusIdx, onMove, movingId }) {
  const stage = stages[focusIdx];
  const tickets = stage?.tickets || [];

  return (
    <div className="flex flex-col gap-3">
      {/* Stage rail */}
      <div className="rounded-[20px] border border-white/[0.08] bg-auto-panel p-3 shadow-auto-soft">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {stages.map((s, idx) => {
            const isActive = idx === focusIdx;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setFocusIdx(idx)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium transition-all ${
                  isActive
                    ? "border-auto-accent/40 bg-auto-accent/15 text-auto-accent shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                    : "border-white/[0.08] bg-white/[0.03] text-white/55 hover:border-white/[0.14] hover:text-white/80"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color || "#6366f1" }}
                />
                <span>{s.name}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    isActive
                      ? "bg-auto-accent/20 text-auto-accent"
                      : "bg-white/[0.06] text-white/35"
                  }`}
                >
                  {(s.tickets || []).length}
                </span>
              </button>
            );
          })}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={focusIdx === 0}
              onClick={() => setFocusIdx(Math.max(0, focusIdx - 1))}
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-white/30">
              {focusIdx + 1}/{stages.length}
            </span>
            <button
              type="button"
              disabled={focusIdx >= stages.length - 1}
              onClick={() => setFocusIdx(Math.min(stages.length - 1, focusIdx + 1))}
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Active column — full width */}
      {stage && (
        <section className="rounded-[24px] border border-white/[0.08] bg-auto-panel p-5 shadow-auto-soft">
          <div className="mb-4 border-b border-white/[0.06] pb-4">
            <div className="flex items-center gap-3">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: stage.color || "#6366f1" }}
              />
              <h2 className="text-xl font-semibold text-white">{stage.name}</h2>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-white/50">
                {tickets.length} tickets
              </span>
            </div>
            {stage.description && (
              <div className="mt-1.5 text-sm text-white/40">{stage.description}</div>
            )}
          </div>

          {tickets.length === 0 ? (
            <EmptyColumn />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {tickets.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  stages={stages}
                  stageId={stage.id}
                  onMove={onMove}
                  movingId={movingId}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Pipeline() {
  const [stages, setStages]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [movingId, setMovingId]   = useState(null);
  const [viewMode, setViewMode]   = useState(() => loadPref("viewMode", "focus"));
  const [focusIdx, setFocusIdx]   = useState(0);

  // Persist viewMode
  useEffect(() => { savePref("viewMode", viewMode); }, [viewMode]);

  // Clamp focusIdx when stages change
  useEffect(() => {
    if (stages.length > 0 && focusIdx >= stages.length) {
      setFocusIdx(stages.length - 1);
    }
  }, [stages.length, focusIdx]);

  // ---------------------------------------------------------------------------
  // Fetch board
  // ---------------------------------------------------------------------------
  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/pipeline/board");
      // The board endpoint returns an array of stages, each with a `tickets` array.
      // Normalise both snake_case and camelCase variants.
      const normalised = (Array.isArray(data) ? data : data?.stages || []).map((s) => ({
        ...s,
        tickets: s.tickets || s.Tickets || [],
      }));
      setStages(normalised);
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        "Error al cargar el pipeline";
      setError(msg);
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  // ---------------------------------------------------------------------------
  // Move ticket
  // ---------------------------------------------------------------------------
  const moveTicket = useCallback(async (ticketId, toStageId) => {
    // Optimistic update: remove ticket from its current stage and add to target
    setStages((prev) => {
      let movedTicket = null;
      const updated = prev.map((s) => {
        const idx = s.tickets.findIndex((t) => t.id === ticketId);
        if (idx === -1) return s;
        movedTicket = s.tickets[idx];
        return { ...s, tickets: s.tickets.filter((t) => t.id !== ticketId) };
      });
      if (!movedTicket) return prev;
      return updated.map((s) =>
        s.id === toStageId
          ? {
              ...s,
              tickets: [
                { ...movedTicket, pipelineStageId: toStageId, pipelineStageUpdatedAt: new Date().toISOString() },
                ...s.tickets,
              ],
            }
          : s
      );
    });

    setMovingId(ticketId);
    try {
      await api.patch(`/pipeline/tickets/${ticketId}/stage`, { toStageId });
    } catch (err) {
      // Roll back on failure
      toastError(err);
      fetchBoard();
    } finally {
      setMovingId(null);
    }
  }, [fetchBoard]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Pipeline</h1>
          {!loading && stages.length > 0 && (
            <div className="mt-0.5 text-[12px] text-white/35">
              {stages.reduce((acc, s) => acc + (s.tickets || []).length, 0)} tickets totales
              &nbsp;·&nbsp;
              {stages.length} etapas
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <button
            type="button"
            onClick={() => setViewMode((v) => (v === "focus" ? "kanban" : "focus"))}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-colors ${
              viewMode === "focus"
                ? "border-auto-accent/30 bg-auto-accent/10 text-auto-accent"
                : "border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]"
            }`}
          >
            {viewMode === "focus" ? (
              <>
                <LayoutList className="h-4 w-4" />
                <span>Vista foco</span>
              </>
            ) : (
              <>
                <Columns className="h-4 w-4" />
                <span>Vista kanban</span>
              </>
            )}
          </button>

          {/* Refresh */}
          <button
            type="button"
            onClick={fetchBoard}
            disabled={loading}
            title="Actualizar"
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <LoadingState viewMode={viewMode} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchBoard} />
      ) : stages.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.02] p-16 text-center">
          <Columns className="h-10 w-10 text-white/20" />
          <div className="text-sm font-medium text-white/40">No hay etapas configuradas</div>
          <div className="text-xs text-white/20">
            Creá la primera etapa desde la configuración del pipeline.
          </div>
        </div>
      ) : viewMode === "focus" ? (
        <FocusView
          stages={stages}
          focusIdx={focusIdx}
          setFocusIdx={setFocusIdx}
          onMove={moveTicket}
          movingId={movingId}
        />
      ) : (
        // Kanban: horizontal scroll
        <div className="flex gap-4 overflow-x-auto pb-3">
          {stages.map((s) => (
            <KanbanColumn
              key={s.id}
              stage={s}
              stages={stages}
              onMove={moveTicket}
              movingId={movingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
