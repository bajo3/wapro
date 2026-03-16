import React, { useMemo } from "react";
import { ListFilter, RefreshCw, Sidebar, X } from "lucide-react";

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
    <div className="rounded-auto-xl border border-auto-border bg-auto-panel px-3 py-3 shadow-auto-soft">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-auto-text">{tabLabel}</div>
          <div className="mt-1 text-xs text-auto-muted">
            Vista operativa del inbox comercial.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onToggleSidebar}
            className="inline-flex h-9 items-center gap-2 rounded-auto-md border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-text hover:bg-auto-panel2"
            type="button"
            title={sidebarVisible ? "Ocultar lista" : "Mostrar lista"}
          >
            <Sidebar className="h-4 w-4" />
            <span>{sidebarVisible ? "Ocultar lista" : "Mostrar lista"}</span>
          </button>

          <button
            onClick={onRefresh}
            className="inline-flex h-9 items-center gap-2 rounded-auto-md border border-auto-border bg-auto-surface px-3 text-xs font-medium text-auto-text hover:bg-auto-panel2"
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Refrescar</span>
          </button>

          <button
            onClick={onClearFilters}
            className="inline-flex h-9 items-center gap-2 rounded-auto-md bg-auto-accent px-3 text-xs font-medium text-white hover:opacity-95"
            type="button"
          >
            <X className="h-4 w-4" />
            <span>Limpiar filtros</span>
          </button>
        </div>
      </div>
    </div>
  );
}
