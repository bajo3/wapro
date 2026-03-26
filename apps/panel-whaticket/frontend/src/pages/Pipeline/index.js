import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Columns, LayoutList } from 'lucide-react';

// NOTE: This file contains only the key modifications required for the new "focus" view
// described in the provided improvement plan. It is not a full replacement for the
// original Pipeline implementation. To integrate this into your repository, merge
// these changes into the existing Pipeline component, keeping the surrounding
// logic (filters, metrics calculation, drag‑and‑drop) intact.

function Pipeline() {
  // The existing pipeline hook exposes board data, filters and persistence helpers.
  const {
    board,
    filteredStages = [],
    metricsByStage = {},
    persistPrefs = () => {},
    // Other methods such as onDragStart, onDrop, moveTicketToRelativeStage, saveTicketValue,
    // history push, etc. should be imported or passed via context as in the original file.
  } = {} as any;

  // Existing state declarations (query, categoryFilter, etc.) should remain here.
  // We show only lookbackDays for brevity; please retain the rest of your state.
  const [lookbackDays, setLookbackDays] = useState(7);

  // New state: view mode ("focus" or "kanban"). Default to stored preference or focus.
  const [viewMode, setViewMode] = useState(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem('pipelinePrefs') || '{}');
      return prefs.viewMode || 'focus';
    } catch {
      return 'focus';
    }
  });

  // Index of the currently focused stage when in focus mode.
  const [focusStageIdx, setFocusStageIdx] = useState(0);

  // Persist the viewMode in local storage whenever it changes.
  useEffect(() => {
    persistPrefs({ viewMode });
  }, [viewMode]);

  // Clamp the focused stage index if the number of stages changes.
  useEffect(() => {
    if (focusStageIdx >= filteredStages.length && filteredStages.length > 0) {
      setFocusStageIdx(filteredStages.length - 1);
    }
  }, [filteredStages.length, focusStageIdx]);

  // Placeholder handlers. In the real implementation these should come from
  // context or props.
  const onDragStart = () => {};
  const onDrop = () => {};
  const moveTicketToRelativeStage = () => {};
  const saveTicketValue = () => {};
  const history = { push: () => {} };

  // Utility functions used by the board (import these from your utils module).
  const getStageAgeMs = () => 0;
  const getUpdatedMs = () => 0;
  const formatAge = () => '';
  const moneyFmt = () => '';
  const statusTone = () => '';
  const STALE_THRESHOLD_HOURS = 72;

  return (
    <div className="flex flex-col gap-4">
      {/* Header actions: add the view toggle alongside existing buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Existing controls (refresh, filters, etc.) should appear here */}
        <button
          type="button"
          onClick={() => setViewMode(viewMode === 'focus' ? 'kanban' : 'focus')}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-colors ${
            viewMode === 'focus'
              ? 'border-auto-accent/30 bg-auto-accent/10 text-auto-accent'
              : 'border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]'
          }`}
        >
          {viewMode === 'focus' ? (
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
      </div>

      {/* Board container: render either focus view or classic kanban */}
      {viewMode === 'focus' ? (
        <div className="flex flex-col gap-3">
          {/* Stage rail */}
          <div className="rounded-[20px] border border-white/[0.08] bg-auto-panel p-3 shadow-auto-soft">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {filteredStages.map((stage, idx) => {
                const metrics = metricsByStage[stage.id] || {};
                const meta = {}; // CATEGORY_META lookups go here in real code
                const isActive = idx === focusStageIdx;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => setFocusStageIdx(idx)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium transition-all ${
                      isActive
                        ? 'border-auto-accent/40 bg-auto-accent/15 text-auto-accent shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                        : 'border-white/[0.08] bg-white/[0.03] text-white/55 hover:border-white/[0.14] hover:text-white/80'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" />
                    <span>{stage.name}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        isActive ? 'bg-auto-accent/20 text-auto-accent' : 'bg-white/[0.06] text-white/35'
                      }`}
                    >
                      {stage.filteredTickets ? stage.filteredTickets.length : 0}
                    </span>
                    {metrics.staleCount > 0 && (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Tiene leads fríos" />
                    )}
                  </button>
                );
              })}
              {/* Navigation buttons for focus mode */}
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFocusStageIdx(Math.max(0, focusStageIdx - 1))}
                  disabled={focusStageIdx === 0}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-white/30">
                  {focusStageIdx + 1}/{filteredStages.length}
                </span>
                <button
                  type="button"
                  onClick={() => setFocusStageIdx(Math.min(filteredStages.length - 1, focusStageIdx + 1))}
                  disabled={focusStageIdx >= filteredStages.length - 1}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
          {/* Active column full width */}
          {filteredStages[focusStageIdx] && (
            <section
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, filteredStages[focusStageIdx].id)}
              className="rounded-[24px] border bg-auto-panel p-5 shadow-auto-soft"
            >
              {/* Stage header */}
              <div className="border-b border-white/[0.06] pb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" />
                      <h2 className="text-xl font-semibold text-white">
                        {filteredStages[focusStageIdx].name}
                      </h2>
                      <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold">
                        {/* category label here */}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-white/40">
                      {(filteredStages[focusStageIdx].filteredTickets || []).length} visibles ·{' '}
                      {(filteredStages[focusStageIdx].rawTickets || []).length} totales
                    </div>
                  </div>
                  {/* Metrics badges (stale count, sum ARS/USD) would go here */}
                </div>
              </div>

              {/* Tickets grid */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredStages[focusStageIdx].filteredTickets &&
                filteredStages[focusStageIdx].filteredTickets.length > 0 ? (
                  filteredStages[focusStageIdx].filteredTickets.map((ticket) => {
                    const stageAgeMs = getStageAgeMs(ticket);
                    const updatedMs = getUpdatedMs(ticket);
                    const isStale = stageAgeMs >= STALE_THRESHOLD_HOURS * 60 * 60 * 1000;
                    const value = Number(ticket?.dealValue);
                    const currency = String(ticket?.dealCurrency || 'ARS').toUpperCase();
                    const hasValue = Number.isFinite(value) && value > 0;
                    return (
                      <article
                        key={ticket.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, ticket.id, filteredStages[focusStageIdx].id)}
                        className={`rounded-2xl border bg-white/[0.03] p-4 transition-all hover:border-white/[0.14] hover:bg-white/[0.05] ${
                          isStale ? 'border-amber-500/20' : 'border-white/[0.08]'
                        }`}
                      >
                        {/* Ticket contents: header with name, status, open link, ages, value inputs and navigation */}
                        {/* For brevity these inner components are omitted here but should mirror your existing implementation */}
                      </article>
                    );
                  })
                ) : (
                  <div className="col-span-full flex items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.02] px-4 py-10 text-center text-sm text-white/30">
                    No hay tickets en esta etapa con los filtros actuales.
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      ) : (
        // Classic Kanban mode: render the original horizontal board. Keep your existing
        // implementation here. The following is a placeholder to illustrate the structure.
        <div className="flex gap-4 overflow-x-auto pb-2">
          {/* Iterate over all stages and render columns horizontally. */}
          {filteredStages.map((stage) => (
            <div key={stage.id} className="w-[360px] flex-shrink-0">
              {/* Column header and tickets similar to your original implementation */}
              <div className="mb-2 flex items-center justify-between">
                <h2>{stage.name}</h2>
              </div>
              <div className="flex flex-col gap-2">
                {(stage.filteredTickets || []).map((ticket) => (
                  <div key={ticket.id} className="rounded-lg border p-3 bg-white/[0.03]">
                    {/* Ticket card contents */}
                    {ticket?.contact?.name || 'Contacto'}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Pipeline;