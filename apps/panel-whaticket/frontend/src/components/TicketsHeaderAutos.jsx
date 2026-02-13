import React, { useMemo } from "react";

function Chip({ label, onRemove }) {
  return (
    <button
      onClick={onRemove}
      className="inline-flex items-center gap-2 rounded-full border border-auto-border bg-auto-panel px-3 py-1 text-xs text-auto-text hover:bg-auto-panel2"
      title="Quitar filtro"
      type="button"
    >
      <span>{label}</span>
      <span className="text-auto-muted">×</span>
    </button>
  );
}

export default function TicketsHeaderAutos({
  activeTab,
  statusTabs,
  filters,
  onClearFilters,
  onRefresh,
}) {
  const tabLabel = useMemo(() => {
    return statusTabs.find((t) => t.key === activeTab)?.label || "Tickets";
  }, [activeTab, statusTabs]);

  const activeChips = useMemo(() => {
    const chips = [];
    if (filters.search) chips.push({ key: "search", label: `Buscar: ${filters.search}` });
    if (filters.queueId !== "all") chips.push({ key: "queue", label: `Cola: ${filters.queueId}` });
    if (filters.whatsappId !== "all") chips.push({ key: "wa", label: `WA: ${filters.whatsappId}` });
    if (filters.leadSource !== "all") chips.push({ key: "lead", label: `Lead: ${filters.leadSource}` });
    return chips;
  }, [filters]);

  return (
    <div className="rounded-auto-xl border border-auto-border bg-auto-panel px-5 py-4 shadow-auto-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-auto-muted">Panel</div>
          <div className="mt-1 text-lg font-semibold text-auto-text">{tabLabel}</div>
          <div className="mt-1 text-sm text-auto-muted">
            Vista optimizada para concesionarias. Orden + velocidad.
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onRefresh}
            className="h-9 rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text hover:bg-auto-panel2"
            type="button"
          >
            Refrescar
          </button>
          <button
            onClick={onClearFilters}
            className="h-9 rounded-auto-md bg-auto-accent px-3 text-sm font-medium text-white hover:opacity-95"
            type="button"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {activeChips.map((c) => (
            <Chip key={c.key} label={c.label} onRemove={onClearFilters} />
          ))}
        </div>
      )}
    </div>
  );
}
