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
  sidebarVisible,
  onToggleSidebar,
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
    <div className="rounded-auto-xl border border-auto-border bg-auto-panel px-4 py-3 shadow-auto-soft">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-auto-muted">Tickets</div>
          <div className="truncate text-base font-semibold text-auto-text">{tabLabel}</div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onToggleSidebar}
            className="hidden md:inline-flex h-9 items-center gap-2 rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text hover:bg-auto-panel2"
            type="button"
            title={sidebarVisible ? "Ocultar lista" : "Mostrar lista"}
          >
            <span className="text-auto-muted">≡</span>
            <span>Lista</span>
          </button>

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
            Limpiar
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
