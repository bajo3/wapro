import React, { useMemo } from "react";
import { RefreshCw, Sidebar, X } from "lucide-react";

const STATUS_COLOR = {
  queue:   { dot: "bg-auto-pending", label: "Cola" },
  working: { dot: "bg-auto-open",    label: "Trabajando" },
  closed:  { dot: "bg-auto-hint",    label: "Cerrados" },
};

export default function TicketsHeaderAutos({
  activeTab,
  statusTabs,
  onClearFilters,
  onRefresh,
  sidebarVisible,
  onToggleSidebar,
}) {
  const tabLabel = useMemo(
    () => statusTabs.find((t) => t.key === activeTab)?.label || "Tickets",
    [activeTab, statusTabs]
  );

  const dot = STATUS_COLOR[activeTab]?.dot || "bg-auto-hint";

  return (
    <div className="rounded-auto-xl border border-auto-border bg-auto-panel px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-auto-text truncate">{tabLabel}</div>
            <div className="text-[11px] text-auto-hint mt-0.5">Inbox comercial</div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onToggleSidebar}
            className="inline-flex h-8 items-center gap-1.5 rounded-auto-md border border-auto-border bg-auto-panel2 px-3 text-xs font-medium text-auto-muted hover:border-auto-border2 hover:text-auto-text transition-colors"
            type="button"
            title={sidebarVisible ? "Ocultar lista" : "Mostrar lista"}
          >
            <Sidebar className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{sidebarVisible ? "Ocultar" : "Mostrar"}</span>
          </button>

          <button
            onClick={onRefresh}
            className="inline-flex h-8 items-center gap-1.5 rounded-auto-md border border-auto-border bg-auto-panel2 px-3 text-xs font-medium text-auto-muted hover:border-auto-border2 hover:text-auto-text transition-colors"
            type="button"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refrescar</span>
          </button>

          <button
            onClick={onClearFilters}
            className="inline-flex h-8 items-center gap-1.5 rounded-auto-md bg-auto-accent px-3 text-xs font-bold text-black hover:bg-auto-accent2 transition-colors"
            type="button"
          >
            <X className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Limpiar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
