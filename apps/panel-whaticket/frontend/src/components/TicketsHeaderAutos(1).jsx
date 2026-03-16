import React, { useMemo } from "react";

export default function TicketsHeaderAutos({
  activeTab,
  statusTabs,
  onClearFilters,
  onRefresh,
  sidebarVisible,
  onToggleSidebar,
}) {
  const tabLabel = useMemo(() => {
    return statusTabs.find((t) => t.key === activeTab)?.label || "Tickets";
  }, [activeTab, statusTabs]);

  return (
    <div className="rounded-auto-xl border border-auto-border bg-auto-panel px-3 py-2 shadow-auto-soft">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-auto-text">{tabLabel}</div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onToggleSidebar}
            className="hidden md:inline-flex h-8 items-center gap-2 rounded-auto-md border border-auto-border bg-auto-panel px-2 text-xs text-auto-text hover:bg-auto-panel2"
            type="button"
            title={sidebarVisible ? "Ocultar lista" : "Mostrar lista"}
          >
            <span className="text-auto-muted">≡</span>
            <span>Lista</span>
          </button>

          <button
            onClick={onRefresh}
            className="h-8 rounded-auto-md border border-auto-border bg-auto-panel px-2 text-xs text-auto-text hover:bg-auto-panel2"
            type="button"
          >
            Refrescar
          </button>

          <button
            onClick={onClearFilters}
            className="h-8 rounded-auto-md bg-auto-accent px-2 text-xs font-medium text-white hover:opacity-95"
            type="button"
          >
            Limpiar
          </button>
        </div>
      </div>
    </div>
  );
}
